import AVFoundation
import AVKit
import CoreMedia
import ExpoModulesCore
import UIKit

/// The source of the printer's Picture in Picture: the camera, or the current
/// layer as a still frame. It sits behind the stage, so the picture iOS takes
/// into the window when the owner leaves the app is the page they last had open.
///
/// The camera comes from the relay's `/api/camera.h264` WebSocket: one H.264
/// access unit (Annex B, parameter sets on each keyframe) per message. The
/// units go to an `AVSampleBufferDisplayLayer` as they are, with no decoder of
/// our own and no added delay.
///
/// The layer frame matches the stage's LCD (`PrinterStage.tsx` `Lcd`): the lit
/// pixels glow while the printer exposes and dim while it lifts and drops, and
/// the phase shows top right and the percent top left. The window's own
/// timeline is the progress bar.
///
/// The window's skip back and skip forward buttons switch between the camera
/// and the layer. The app's stage page sets the view again when the owner
/// comes back. iOS shows those buttons only for a finite time range, so the
/// range is the print's time and the window's timeline shows its progress.
final class PrinterPipView: ExpoView, AVPictureInPictureControllerDelegate, AVPictureInPictureSampleBufferPlaybackDelegate {
  enum Mode { case camera, layer }

  /// The stage page the owner last had open.
  var pageMode: Mode = .layer { didSet { if pageMode != oldValue { mode = pageMode } } }
  private var mode: Mode = .layer { didSet { if mode != oldValue { refresh() } } }
  var cameraUrl: URL? { didSet { if cameraUrl != oldValue { refresh() } } }
  var layerUri: URL? { didSet { if layerUri != oldValue { loadLayer() } } }
  var tint: UIColor = .white { didSet { tintedLayer = nil; showLayer() } }
  /// The phase label ("Exposing", "Lifting", …) while a print runs.
  var phase: String? { didSet { if phase != oldValue { showLayer() } } }
  var exposing = false { didSet { if exposing != oldValue { animateGlow() } } }
  var active = false { didSet { if active != oldValue { showLayer() } } }
  var glowColor: UIColor = .white { didSet { showLayer() } }
  var phaseColor: UIColor = .white { didSet { showLayer() } }
  var dotColor: UIColor = .white { didSet { showLayer() } }
  /// The print's progress, 0 to 100; nil with no print.
  var percent: Double? { didSet { if percent != oldValue { showLayer() } } }
  var elapsedMs: Double? { didSet { updateTimeline() } }
  var remainingMs: Double? { didSet { updateTimeline() } }
  /// The window's timeline: the print's start and end on the host clock.
  private var timeline = CMTimeRange(start: .zero, duration: .zero)
  var aspect: CGFloat = 16.0 / 9.0 { didSet { if aspect != oldValue { showLayer() } } }
  /// True while the stage is on screen: only then may leaving the app start the window.
  var enabled = false { didSet { if enabled != oldValue { refresh() } } }

  private let display = AVSampleBufferDisplayLayer()
  private var pip: AVPictureInPictureController?
  private var pipActive = false
  private var foreground = UIApplication.shared.applicationState != .background

  private let queue = DispatchQueue(label: "printer-pip.video")
  private var socket: URLSessionWebSocketTask?
  private var socketUrl: URL?
  private var format: CMVideoFormatDescription?
  private var sps: Data?
  private var pps: Data?

  private var layerImage: UIImage? { didSet { tintedLayer = nil } }
  private var tintedLayer: UIImage?
  /// 0 while the printer lifts or drops, 1 while it exposes; eases between them like the stage.
  private var glow: CGFloat = 0
  private var glowFrom: CGFloat = 0
  private var glowStart: CFTimeInterval = 0
  private var glowTimer: Timer?
  private var layerTask: URLSessionDataTask?
  /// iOS treats a source with no new frames as stalled: the still is shown again every second.
  private var stillTimer: Timer?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    backgroundColor = .black
    clipsToBounds = true
    display.videoGravity = .resizeAspect
    display.backgroundColor = UIColor.black.cgColor
    // The window's playhead: the host clock, which the drawn frames are stamped with.
    var timebase: CMTimebase?
    if CMTimebaseCreateWithSourceClock(allocator: kCFAllocatorDefault, sourceClock: CMClockGetHostTimeClock(), timebaseOut: &timebase) == noErr, let timebase {
      CMTimebaseSetTime(timebase, time: CMClockGetTime(CMClockGetHostTimeClock()))
      CMTimebaseSetRate(timebase, rate: 1)
      display.controlTimebase = timebase
    }
    layer.addSublayer(display)

    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
    center.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    stillTimer?.invalidate()
    glowTimer?.invalidate()
    layerTask?.cancel()
    socket?.cancel(with: .goingAway, reason: nil)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    display.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, pip == nil, AVPictureInPictureController.isPictureInPictureSupported() {
      let controller = AVPictureInPictureController(
        contentSource: AVPictureInPictureController.ContentSource(sampleBufferDisplayLayer: display, playbackDelegate: self)
      )
      controller.delegate = self
      // Off, so the window shows the skip buttons that switch the view.
      controller.requiresLinearPlayback = false
      pip = controller
      updateTimeline()
    }
    refresh()
  }

  // MARK: - What runs

  /// Shows the source the props and the app's state call for, and stops what is not needed.
  private func refresh() {
    let live = (enabled && window != nil && foreground) || pipActive
    pip?.canStartPictureInPictureAutomaticallyFromInline = enabled && window != nil
    if enabled { Self.preparePlayback() }

    if live && mode == .camera, let url = cameraUrl {
      stopStill()
      connect(url)
    } else {
      disconnect()
      if live && mode == .layer { startStill() } else { stopStill() }
    }
  }

  @objc private func didEnterBackground() {
    foreground = false
    // The window starts as the app leaves; give it a moment before stopping the feed.
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.refresh() }
  }

  @objc private func willEnterForeground() {
    foreground = true
    mode = pageMode
    refresh()
  }

  /// PiP needs a playback audio session. Mixing keeps the owner's music playing.
  private static var playbackReady = false
  private static func preparePlayback() {
    guard !playbackReady else { return }
    playbackReady = true
    do {
      try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, options: [.mixWithOthers])
    } catch {
      NSLog("[printer-pip] audio session: \(error)")
    }
  }

  // MARK: - Camera

  private func connect(_ url: URL) {
    if socket != nil && socketUrl == url { return }
    disconnect()
    display.flushAndRemoveImage()
    let task = URLSession.shared.webSocketTask(with: url)
    socket = task
    socketUrl = url
    task.resume()
    receive(task)
  }

  private func disconnect() {
    socket?.cancel(with: .goingAway, reason: nil)
    socket = nil
    socketUrl = nil
  }

  private func receive(_ task: URLSessionWebSocketTask) {
    task.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(.data(let unit)):
        self.queue.async { self.enqueue(accessUnit: unit) }
        self.receive(task)
      case .success:
        self.receive(task)
      case .failure(let error):
        DispatchQueue.main.async {
          guard self.socket === task else { return }
          NSLog("[printer-pip] camera socket closed: \(error.localizedDescription)")
          self.socket = nil
          self.socketUrl = nil
          // The relay restarts the printer's stream on demand: try again shortly.
          DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.refresh() }
        }
      }
    }
  }

  /// Turns one Annex B access unit into a sample the display layer shows at once.
  private func enqueue(accessUnit: Data) {
    var body = Data()
    for nal in Self.nalUnits(accessUnit) {
      guard let first = nal.first else { continue }
      switch first & 0x1f {
      case 7: sps = nal
      case 8: pps = nal
      case 9: continue
      default:
        var length = UInt32(nal.count).bigEndian
        body.append(Data(bytes: &length, count: 4))
        body.append(nal)
      }
    }
    if let sps, let pps, format == nil || !Self.matches(format, sps: sps, pps: pps) {
      format = Self.formatDescription(sps: sps, pps: pps)
    }
    guard let format, !body.isEmpty, let sample = Self.sample(body, format: format) else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self, self.mode == .camera else { return }
      self.show(sample)
    }
  }

  // MARK: - Layer

  private func loadLayer() {
    layerTask?.cancel()
    guard let url = layerUri else {
      layerImage = nil
      showLayer()
      return
    }
    let task = URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
      guard let data, error == nil, let image = UIImage(data: data) else { return }
      DispatchQueue.main.async {
        guard let self, self.layerUri == url else { return }
        self.layerImage = image
        self.showLayer()
      }
    }
    layerTask = task
    task.resume()
  }

  private func startStill() {
    showLayer()
    guard stillTimer == nil else { return }
    stillTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.showLayer() }
  }

  private func stopStill() {
    stillTimer?.invalidate()
    stillTimer = nil
  }

  /// The stage's `Animated.timing`: 320 ms, ease in and out, about 30 frames a second.
  private func animateGlow() {
    glowFrom = glow
    glowStart = CACurrentMediaTime()
    glowTimer?.invalidate()
    glowTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] timer in
      guard let self else { return timer.invalidate() }
      let t = min(1, CGFloat((CACurrentMediaTime() - self.glowStart) / 0.32))
      let eased = t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2
      let target: CGFloat = self.exposing ? 1 : 0
      self.glow = self.glowFrom + (target - self.glowFrom) * eased
      if t >= 1 {
        timer.invalidate()
        self.glowTimer = nil
      }
      self.showLayer()
    }
  }

  /// Draws the layer the way the stage does: lit pixels in the tint with the glow, on black, at the LCD's shape, and the phase.
  private func showLayer() {
    guard mode == .layer, stillTimer != nil || enabled || pipActive else { return }
    let width = 960
    let height = max(2, Int((CGFloat(width) / aspect).rounded() / 2) * 2)
    // Stage points to frame pixels: the stage is about 240 pt wide where the window is, so the phase reads at the stage's size.
    let scale = CGFloat(width) / 240
    if tintedLayer == nil { tintedLayer = layerImage?.withTintColor(tint, renderingMode: .alwaysOriginal) }
    let image = tintedLayer
    let opacity = (active ? 0.4 : 0.55) + ((1 - (active ? 0.4 : 0.55)) * glow)
    guard let buffer = Self.pixelBuffer(width: width, height: height, draw: { context, size in
      context.setFillColor(UIColor.black.cgColor)
      context.fill(CGRect(origin: .zero, size: size))
      UIGraphicsPushContext(context)
      defer { UIGraphicsPopContext() }
      if let image {
        context.saveGState()
        context.setAlpha(opacity)
        context.beginTransparencyLayer(auxiliaryInfo: nil)
        context.setShadow(offset: .zero, blur: 9 * scale, color: self.glowColor.withAlphaComponent(0.95).cgColor)
        image.draw(in: CGRect(origin: .zero, size: size))
        context.endTransparencyLayer()
        context.restoreGState()
      }
      if self.active, let phase = self.phase {
        self.drawPhase(phase, scale: scale, width: size.width)
      }
      if let percent = self.percent {
        self.drawPercent(percent, scale: scale)
      }
    }), let sample = Self.sample(buffer) else { return }
    show(sample)
  }

  /// The percent in a chip top left.
  private func drawPercent(_ percent: Double, scale: CGFloat) {
    let font = UIFont.monospacedDigitSystemFont(ofSize: 11 * scale, weight: .semibold)
    let text = NSAttributedString(
      string: String(format: "%.1f%%", min(100, max(0, percent))),
      attributes: [.font: font, .foregroundColor: UIColor(red: 244 / 255, green: 245 / 255, blue: 249 / 255, alpha: 0.88)]
    )
    let textSize = text.size()
    let chip = CGRect(x: 8 * scale, y: 8 * scale, width: 16 * scale + textSize.width, height: 22 * scale)
    Self.drawChip(chip, scale: scale)
    text.draw(at: CGPoint(x: chip.minX + 8 * scale, y: chip.midY - textSize.height / 2))

  }

  /// The stage's dark glass chip.
  private static func drawChip(_ chip: CGRect, scale: CGFloat) {
    let shape = UIBezierPath(roundedRect: chip, cornerRadius: 7 * scale)
    UIColor(red: 10 / 255, green: 11 / 255, blue: 18 / 255, alpha: 0.62).setFill()
    shape.fill()
    UIColor(white: 1, alpha: 0.12).setStroke()
    shape.lineWidth = scale / 3
    shape.stroke()
  }

  /// The stage's phase chip: dark glass top right, with a dot and the accent while the printer exposes.
  private func drawPhase(_ phase: String, scale: CGFloat, width: CGFloat) {
    let font = UIFont.systemFont(ofSize: 11 * scale, weight: .semibold)
    let color = exposing ? phaseColor : UIColor(red: 244 / 255, green: 245 / 255, blue: 249 / 255, alpha: 0.88)
    let text = NSAttributedString(string: phase, attributes: [.font: font, .foregroundColor: color])
    let textSize = text.size()
    let dot = exposing ? 6 * scale : 0
    let gap = exposing ? 5 * scale : 0
    let padding = 8 * scale
    let height = 22 * scale
    let chip = CGRect(x: width - 8 * scale - (padding * 2 + dot + gap + textSize.width), y: 8 * scale, width: padding * 2 + dot + gap + textSize.width, height: height)
    Self.drawChip(chip, scale: scale)
    if exposing {
      dotColor.setFill()
      UIBezierPath(ovalIn: CGRect(x: chip.minX + padding, y: chip.midY - dot / 2, width: dot, height: dot)).fill()
    }
    text.draw(at: CGPoint(x: chip.minX + padding + dot + gap, y: chip.midY - textSize.height / 2))
  }

  private func show(_ sample: CMSampleBuffer) {
    if #available(iOS 17.0, *) {
      let renderer = display.sampleBufferRenderer
      if renderer.status == .failed { renderer.flush() }
      renderer.enqueue(sample)
    } else {
      if display.status == .failed { display.flush() }
      display.enqueue(sample)
    }
  }

  // MARK: - Picture in Picture

  func pictureInPictureControllerWillStartPictureInPicture(_ controller: AVPictureInPictureController) {
    pipActive = true
    refresh()
  }

  func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
    pipActive = false
    refresh()
  }

  func pictureInPictureController(_ controller: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
    NSLog("[printer-pip] could not start: \(error.localizedDescription)")
    pipActive = false
    refresh()
  }

  func pictureInPictureController(_ controller: AVPictureInPictureController, setPlaying playing: Bool) {}

  func pictureInPictureControllerTimeRangeForPlayback(_ controller: AVPictureInPictureController) -> CMTimeRange {
    timeline
  }

  /// The print's start and end on the host clock; with no print, a day each side of now.
  private func updateTimeline() {
    let now = CMClockGetTime(CMClockGetHostTimeClock()).seconds
    let next: CMTimeRange
    if let elapsedMs, let remainingMs {
      next = CMTimeRange(start: CMTime(seconds: now - elapsedMs / 1000, preferredTimescale: 600), duration: CMTime(seconds: (elapsedMs + remainingMs) / 1000, preferredTimescale: 600))
    } else {
      next = CMTimeRange(start: CMTime(seconds: now - 86_400, preferredTimescale: 600), duration: CMTime(seconds: 2 * 86_400, preferredTimescale: 600))
    }
    // The elapsed time moves every second; tell iOS only when the end moves by more than a few seconds.
    guard abs(next.start.seconds - timeline.start.seconds) > 5 || abs(next.end.seconds - timeline.end.seconds) > 5 else { return }
    timeline = next
    pip?.invalidatePlaybackState()
  }

  func pictureInPictureControllerIsPlaybackPaused(_ controller: AVPictureInPictureController) -> Bool { false }

  func pictureInPictureController(_ controller: AVPictureInPictureController, didTransitionToRenderSize newRenderSize: CMVideoDimensions) {}

  /// Skip back and skip forward switch the view: there are two, so both buttons go to the other one.
  func pictureInPictureController(_ controller: AVPictureInPictureController, skipByInterval skipInterval: CMTime, completion completionHandler: @escaping () -> Void) {
    DispatchQueue.main.async { [weak self] in
      defer { completionHandler() }
      guard let self else { return }
      self.mode = self.mode == .camera ? .layer : (self.cameraUrl == nil ? .layer : .camera)
    }
  }

  // MARK: - Helpers

  static func color(hex: String) -> UIColor {
    let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    guard digits.count == 6 || digits.count == 8, let value = UInt64(digits, radix: 16) else { return .white }
    let rgb = digits.count == 8 ? value >> 8 : value
    return UIColor(
      red: CGFloat((rgb >> 16) & 0xff) / 255,
      green: CGFloat((rgb >> 8) & 0xff) / 255,
      blue: CGFloat(rgb & 0xff) / 255,
      alpha: 1
    )
  }

  /// The NAL units of an Annex B byte stream, without their start codes.
  static func nalUnits(_ data: Data) -> [Data] {
    let bytes = [UInt8](data)
    var starts: [(code: Int, body: Int)] = []
    var i = 0
    while i + 2 < bytes.count {
      if bytes[i] == 0, bytes[i + 1] == 0, bytes[i + 2] == 1 {
        let code = i > 0 && bytes[i - 1] == 0 ? i - 1 : i
        starts.append((code, i + 3))
        i += 3
      } else {
        i += 1
      }
    }
    return starts.enumerated().compactMap { index, start in
      let end = index + 1 < starts.count ? starts[index + 1].code : bytes.count
      return end > start.body ? Data(bytes[start.body..<end]) : nil
    }
  }

  private static func formatDescription(sps: Data, pps: Data) -> CMVideoFormatDescription? {
    var format: CMVideoFormatDescription?
    let status = sps.withUnsafeBytes { spsBytes in
      pps.withUnsafeBytes { ppsBytes -> OSStatus in
        let pointers = [
          spsBytes.bindMemory(to: UInt8.self).baseAddress!,
          ppsBytes.bindMemory(to: UInt8.self).baseAddress!,
        ]
        let sizes = [sps.count, pps.count]
        return CMVideoFormatDescriptionCreateFromH264ParameterSets(
          allocator: kCFAllocatorDefault,
          parameterSetCount: 2,
          parameterSetPointers: pointers,
          parameterSetSizes: sizes,
          nalUnitHeaderLength: 4,
          formatDescriptionOut: &format
        )
      }
    }
    return status == noErr ? format : nil
  }

  /// True when `format` was made from these parameter sets.
  private static func matches(_ format: CMVideoFormatDescription?, sps: Data, pps: Data) -> Bool {
    guard let format else { return false }
    func parameterSet(_ index: Int) -> Data? {
      var pointer: UnsafePointer<UInt8>?
      var size = 0
      let status = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
        format, parameterSetIndex: index, parameterSetPointerOut: &pointer, parameterSetSizeOut: &size,
        parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil
      )
      guard status == noErr, let pointer else { return nil }
      return Data(bytes: pointer, count: size)
    }
    return parameterSet(0) == sps && parameterSet(1) == pps
  }

  /// One length-prefixed access unit as a sample to show at once.
  private static func sample(_ body: Data, format: CMVideoFormatDescription) -> CMSampleBuffer? {
    var block: CMBlockBuffer?
    guard CMBlockBufferCreateWithMemoryBlock(
      allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: body.count, blockAllocator: kCFAllocatorDefault,
      customBlockSource: nil, offsetToData: 0, dataLength: body.count, flags: kCMBlockBufferAssureMemoryNowFlag,
      blockBufferOut: &block
    ) == noErr, let block else { return nil }
    let copied = body.withUnsafeBytes { bytes in
      CMBlockBufferReplaceDataBytes(with: bytes.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: body.count)
    }
    guard copied == noErr else { return nil }
    var sample: CMSampleBuffer?
    var size = body.count
    guard CMSampleBufferCreateReady(
      allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: format, sampleCount: 1,
      sampleTimingEntryCount: 0, sampleTimingArray: nil, sampleSizeEntryCount: 1, sampleSizeArray: &size,
      sampleBufferOut: &sample
    ) == noErr, let sample else { return nil }
    displayImmediately(sample)
    return sample
  }

  /// A drawn frame as a sample to show at once.
  private static func sample(_ buffer: CVPixelBuffer) -> CMSampleBuffer? {
    var format: CMVideoFormatDescription?
    guard CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buffer, formatDescriptionOut: &format) == noErr,
          let format else { return nil }
    var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), decodeTimeStamp: .invalid)
    var sample: CMSampleBuffer?
    guard CMSampleBufferCreateReadyWithImageBuffer(
      allocator: kCFAllocatorDefault, imageBuffer: buffer, formatDescription: format, sampleTiming: &timing, sampleBufferOut: &sample
    ) == noErr, let sample else { return nil }
    displayImmediately(sample)
    return sample
  }

  private static func displayImmediately(_ sample: CMSampleBuffer) {
    guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true),
          CFArrayGetCount(attachments) > 0 else { return }
    let dictionary = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
    CFDictionarySetValue(
      dictionary,
      Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
      Unmanaged.passUnretained(kCFBooleanTrue).toOpaque()
    )
  }

  private static func pixelBuffer(width: Int, height: Int, draw: (CGContext, CGSize) -> Void) -> CVPixelBuffer? {
    var buffer: CVPixelBuffer?
    let attributes: [CFString: Any] = [
      kCVPixelBufferCGImageCompatibilityKey: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey: true,
      kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
    ]
    guard CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, attributes as CFDictionary, &buffer) == kCVReturnSuccess,
          let buffer else { return nil }
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let context = CGContext(
      data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    ) else { return nil }
    // UIKit draws top-down; the bitmap context is bottom-up.
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: 1, y: -1)
    draw(context, CGSize(width: width, height: height))
    return buffer
  }
}
