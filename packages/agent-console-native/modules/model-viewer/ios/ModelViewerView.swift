import ExpoModulesCore
import SceneKit
import UIKit
import simd

/// A print's 3D model from the relay (`model.mesh`, saturn-uploader
/// `src/LayerMesh.ts`), in SceneKit. One finger turns the model about the
/// vertical axis and tilts it, two fingers move it, and a pinch zooms.
///
/// The file: `SLMS`, the version (2; version 1 files are mirrored), the vertex and triangle counts, the
/// bounds' low and high corners in mm, the layer height and count, then each
/// vertex as three u16 across the bounds, padding to 4 bytes, and each
/// triangle as three u32 indices, counter-clockwise from outside. All
/// little-endian. The model's Z is up from the build plate; SceneKit's up is
/// Y, so the model node turns a quarter turn about X.
///
/// A new file with the same bounds (a finer level of the same model) takes
/// the old one's place and keeps the view. A crop (`clipLowMm`,
/// `clipHighMm`, heights above the plate) hides the model outside the range,
/// so the inside shows: its inner walls are drawn darker.
///
/// A plan's supports can show beside the model (`supportsUri`, in their own
/// colour, the same file format and frame), with markers at points in the
/// model's frame (requirements, the selected support). A tap sends a ray in
/// the model's frame, in mm (`onRayTap`): the app finds the supports along it.
struct ModelMarker: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var z: Double = 0
  @Field var color: String = "#ff3b30"
  /// The marker's radius in mm.
  @Field var radius: Double = 0.6
}

final class ModelViewerView: ExpoView {
  var uri: URL? { didSet { if uri != oldValue { load() } } }
  var supportsUri: URL? { didSet { if supportsUri != oldValue { loadSupports() } } }
  var supportsColor: UIColor = UIColor(red: 1, green: 0.62, blue: 0.04, alpha: 1) { didSet { supportsMaterial.diffuse.contents = supportsColor } }
  var markers: [ModelMarker] = [] { didSet { showMarkers() } }
  /// One support tree's triangles, drawn over everything in its own colour: the selected support, whole.
  var highlightUri: URL? { didSet { if highlightUri != oldValue { loadHighlight() } } }
  var highlightColor: UIColor = UIColor(red: 0.2, green: 0.6, blue: 1, alpha: 1) { didSet { highlightMaterial.diffuse.contents = highlightColor } }
  let onRayTap = EventDispatcher()
  var modelColor: UIColor = UIColor(white: 0.85, alpha: 1) { didSet { material.diffuse.contents = modelColor } }
  var clipLowMm: Double? { didSet { if clipLowMm != oldValue { applyClip() } } }
  var clipHighMm: Double? { didSet { if clipHighMm != oldValue { applyClip() } } }
  /// The cut box's x and y ranges (mm, the model's frame). With a range set, the view frames the box.
  var clipMinX: Double? { didSet { if clipMinX != oldValue { applyClip() } } }
  var clipMaxX: Double? { didSet { if clipMaxX != oldValue { applyClip() } } }
  var clipMinY: Double? { didSet { if clipMinY != oldValue { applyClip() } } }
  var clipMaxY: Double? { didSet { if clipMaxY != oldValue { applyClip() } } }
  /// How opaque the model and the supports are, 0 to 1.
  var modelOpacity: Double = 1 { didSet { if modelOpacity != oldValue { applyOpacity() } } }
  var supportsOpacity: Double = 1 { didSet { if supportsOpacity != oldValue { applyOpacity() } } }
  /// "support": one finger paints on the selected support (the highlight); "model": on the model; "off": no paint.
  /// While painting, two fingers turn the view and a pinch zooms.
  var paintMode: String = "off" { didSet { if paintMode != oldValue { applyPaintMode() } } }
  var paintColor: UIColor = UIColor(red: 1, green: 0.23, blue: 0.19, alpha: 1)
  let onPaintStroke = EventDispatcher()

  /// Discards every fragment outside the cut box, in the node's own space (mm), and darkens the back faces it shows.
  private static let clipShader = """
  #pragma arguments
  float clipLow;
  float clipHigh;
  float clipLowX;
  float clipHighX;
  float clipLowY;
  float clipHighY;
  #pragma body
  float4 local = scn_node.inverseModelViewTransform * float4(_surface.position, 1.0);
  if (local.z < clipLow || local.z > clipHigh || local.x < clipLowX || local.x > clipHighX || local.y < clipLowY || local.y > clipHighY) {
    discard_fragment();
  }
  if (dot(_surface.normal, _surface.view) < 0.0) {
    _output.color.rgb *= 0.5;
  }
  """

  private let scnView = SCNView()
  private let scene = SCNScene()
  private let material = SCNMaterial()
  private let supportsMaterial = SCNMaterial()
  private let highlightMaterial = SCNMaterial()
  private var highlightNode: SCNNode?
  private var highlightGeneration = 0
  private let cameraNode = SCNNode()
  /// The model's frame: Z up from the plate, turned so SceneKit's Y is up. The model, the supports, and the markers sit in it.
  private let frameNode = SCNNode()
  private let markersNode = SCNNode()
  private var modelNode: SCNNode?
  private var supportsNode: SCNNode?
  private var supportsGeneration = 0
  /// Each load has a number, so a slow parse of an old file never replaces a newer one.
  private var generation = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    material.diffuse.contents = modelColor
    material.lightingModel = .blinn
    material.specular.contents = UIColor(white: 0.25, alpha: 1)
    material.shininess = 0.35
    supportsMaterial.diffuse.contents = supportsColor
    supportsMaterial.lightingModel = .blinn
    supportsMaterial.specular.contents = UIColor(white: 0.2, alpha: 1)
    highlightMaterial.diffuse.contents = highlightColor
    highlightMaterial.lightingModel = .lambert
    // The selected tree shows through the model and the other supports.
    highlightMaterial.readsFromDepthBuffer = false
    frameNode.eulerAngles.x = -.pi / 2
    frameNode.addChildNode(markersNode)
    frameNode.addChildNode(strokeNode)
    scene.rootNode.addChildNode(frameNode)

    let camera = SCNCamera()
    camera.fieldOfView = 40
    cameraNode.camera = camera
    scene.rootNode.addChildNode(cameraNode)
    let ambient = SCNNode()
    ambient.light = SCNLight()
    ambient.light?.type = .ambient
    ambient.light?.color = UIColor(white: 0.35, alpha: 1)
    scene.rootNode.addChildNode(ambient)

    scnView.scene = scene
    scnView.backgroundColor = .clear
    scnView.antialiasingMode = .multisampling4X
    // A light at the camera: the side the owner looks at is always lit.
    scnView.autoenablesDefaultLighting = true
    scnView.allowsCameraControl = true
    scnView.defaultCameraController.interactionMode = .orbitTurntable
    scnView.defaultCameraController.inertiaEnabled = true
    scnView.pointOfView = cameraNode
    addSubview(scnView)
    let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
    scnView.addGestureRecognizer(tap)
  }

  /// The finger's reach on screen, in points: the ray's spread is the angle it covers.
  private static let fingerPoints: CGFloat = 14

  /// Sends the tap as a ray in the model's frame (mm): where the camera is, the direction
  /// through the finger, and the spread of the finger's reach (radians). The ray goes on
  /// through the model and every support, so a support behind another one, or seen from
  /// inside the model, can still be picked. Nothing is hit-tested here.
  @objc private func tapped(_ recognizer: UITapGestureRecognizer) {
    let location = recognizer.location(in: scnView)
    func world(_ x: CGFloat, _ y: CGFloat, _ depth: Float) -> SCNVector3 {
      scnView.unprojectPoint(SCNVector3(Float(x), Float(y), depth))
    }
    let near = frameNode.convertPosition(world(location.x, location.y, 0), from: nil)
    let far = frameNode.convertPosition(world(location.x, location.y, 1), from: nil)
    let edge = frameNode.convertPosition(world(location.x + ModelViewerView.fingerPoints, location.y, 1), from: nil)
    let direction = simd_normalize(SIMD3<Float>(far.x - near.x, far.y - near.y, far.z - near.z))
    let toEdge = simd_normalize(SIMD3<Float>(edge.x - near.x, edge.y - near.y, edge.z - near.z))
    let spread = acos(max(-1, min(1, simd_dot(direction, toEdge))))
    onRayTap([
      "ox": Double(near.x),
      "oy": Double(near.y),
      "oz": Double(near.z),
      "dx": Double(direction.x),
      "dy": Double(direction.y),
      "dz": Double(direction.z),
      "spread": Double(spread),
    ])
  }

  private func loadSupports() {
    supportsGeneration += 1
    let current = supportsGeneration
    guard let supportsUri else {
      supportsNode?.removeFromParentNode()
      supportsNode = nil
      return
    }
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let geometry = (try? Data(contentsOf: supportsUri, options: .mappedIfSafe)).flatMap(ModelViewerView.geometry(from:))
      DispatchQueue.main.async {
        guard let self, current == self.supportsGeneration, let geometry else { return }
        geometry.materials = [self.supportsMaterial]
        self.supportsNode?.removeFromParentNode()
        let node = SCNNode(geometry: geometry)
        self.frameNode.addChildNode(node)
        self.supportsNode = node
        self.applyOpacity()
      }
    }
  }

  private func loadHighlight() {
    highlightGeneration += 1
    let current = highlightGeneration
    guard let highlightUri else {
      highlightNode?.removeFromParentNode()
      highlightNode = nil
      return
    }
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let geometry = (try? Data(contentsOf: highlightUri, options: .mappedIfSafe)).flatMap(ModelViewerView.geometry(from:))
      DispatchQueue.main.async {
        guard let self, current == self.highlightGeneration else { return }
        self.highlightNode?.removeFromParentNode()
        self.highlightNode = nil
        guard let geometry else { return }
        geometry.materials = [self.highlightMaterial]
        let node = SCNNode(geometry: geometry)
        node.renderingOrder = 5
        self.frameNode.addChildNode(node)
        self.highlightNode = node
      }
    }
  }

  private func showMarkers() {
    markersNode.childNodes.forEach { $0.removeFromParentNode() }
    for marker in markers {
      let sphere = SCNSphere(radius: CGFloat(marker.radius))
      let paint = SCNMaterial()
      paint.diffuse.contents = ModelViewerView.color(hex: marker.color)
      paint.lightingModel = .constant
      // Markers show through the model, so a point inside it is still seen.
      paint.readsFromDepthBuffer = false
      sphere.materials = [paint]
      let node = SCNNode(geometry: sphere)
      node.position = SCNVector3(Float(marker.x), Float(marker.y), Float(marker.z))
      node.renderingOrder = 10
      markersNode.addChildNode(node)
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    scnView.frame = bounds
  }

  private func load() {
    generation += 1
    let current = generation
    guard let uri else {
      modelNode?.removeFromParentNode()
      modelNode = nil
      return
    }
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let geometry = (try? Data(contentsOf: uri, options: .mappedIfSafe)).flatMap(ModelViewerView.geometry(from:))
      DispatchQueue.main.async {
        guard let self, current == self.generation, let geometry else { return }
        self.show(geometry)
      }
    }
  }

  private var hasBox: Bool { clipMinX != nil || clipMaxX != nil || clipMinY != nil || clipMaxY != nil }

  private func applyClip() {
    let materials = [material, supportsMaterial, highlightMaterial]
    guard clipLowMm != nil || clipHighMm != nil || hasBox else {
      for each in materials {
        each.shaderModifiers = nil
      }
      material.isDoubleSided = false
      return
    }
    let far: Double = 1_000_000
    for each in materials {
      each.shaderModifiers = [.fragment: ModelViewerView.clipShader]
      each.setValue(Float(clipLowMm ?? -far), forKey: "clipLow")
      each.setValue(Float(clipHighMm ?? far), forKey: "clipHigh")
      each.setValue(Float(clipMinX ?? -far), forKey: "clipLowX")
      each.setValue(Float(clipMaxX ?? far), forKey: "clipHighX")
      each.setValue(Float(clipMinY ?? -far), forKey: "clipLowY")
      each.setValue(Float(clipMaxY ?? far), forKey: "clipHighY")
    }
    material.isDoubleSided = true
    if hasBox { frameBox() }
  }

  /// Turns the view about the cut box's centre and brings the camera close enough that the box fills the view.
  private func frameBox() {
    guard let model = modelNode else { return }
    let (low, high) = model.boundingBox
    let x0 = Float(clipMinX ?? Double(low.x)), x1 = Float(clipMaxX ?? Double(high.x))
    let y0 = Float(clipMinY ?? Double(low.y)), y1 = Float(clipMaxY ?? Double(high.y))
    let z0 = Float(clipLowMm ?? Double(low.z)), z1 = Float(min(clipHighMm ?? Double(high.z), Double(high.z)))
    guard x1 > x0, y1 > y0, z1 > z0 else { return }
    let centre = frameNode.convertPosition(SCNVector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), to: scene.rootNode)
    let radius = sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) + (z1 - z0) * (z1 - z0)) / 2
    let distance = max(radius, 1) / tan(Float(20.0 * Double.pi / 180)) * 1.15
    let eye = cameraNode.presentation.worldPosition
    var direction = SIMD3<Float>(eye.x - centre.x, eye.y - centre.y, eye.z - centre.z)
    if simd_length(direction) < 0.001 { direction = SIMD3<Float>(0, 0.4, 1) }
    direction = simd_normalize(direction)
    cameraNode.position = SCNVector3(centre.x + direction.x * distance, centre.y + direction.y * distance, centre.z + direction.z * distance)
    cameraNode.look(at: centre)
    cameraNode.camera?.zNear = Double(max(0.05, distance - radius * 2))
    cameraNode.camera?.zFar = Double(distance + radius * 4 + 200)
    scnView.defaultCameraController.target = centre
  }

  private func applyOpacity() {
    for (each, opacity) in [(material, modelOpacity), (supportsMaterial, supportsOpacity)] {
      let clamped = max(0, min(1, opacity))
      each.transparency = CGFloat(clamped)
      // A see-through part writes no depth, so what is behind it still draws.
      each.writesToDepthBuffer = clamped >= 1
      each.transparencyMode = .dualLayer
    }
    modelNode?.isHidden = modelOpacity <= 0
    supportsNode?.isHidden = supportsOpacity <= 0
  }

  // MARK: Painting

  private let strokeNode = SCNNode()
  private var stroke: [SCNVector3] = []
  private lazy var paintPan: UIPanGestureRecognizer = {
    let pan = UIPanGestureRecognizer(target: self, action: #selector(painted(_:)))
    pan.maximumNumberOfTouches = 1
    return pan
  }()
  private lazy var orbitPan: UIPanGestureRecognizer = {
    let pan = UIPanGestureRecognizer(target: self, action: #selector(orbited(_:)))
    pan.minimumNumberOfTouches = 2
    return pan
  }()
  private lazy var zoomPinch = UIPinchGestureRecognizer(target: self, action: #selector(zoomed(_:)))

  private func applyPaintMode() {
    let painting = paintMode == "support" || paintMode == "model"
    if paintPan.view == nil {
      for gesture in [paintPan, orbitPan, zoomPinch] as [UIGestureRecognizer] {
        scnView.addGestureRecognizer(gesture)
      }
    }
    for gesture in [paintPan, orbitPan, zoomPinch] as [UIGestureRecognizer] {
      gesture.isEnabled = painting
    }
    scnView.allowsCameraControl = !painting
    clearStroke()
  }

  private func clearStroke() {
    stroke = []
    strokeNode.childNodes.forEach { $0.removeFromParentNode() }
  }

  /// One finger: a stroke on the target's surface only. Each point is kept in the model's frame (mm); the stroke is sent when the finger lifts.
  @objc private func painted(_ recognizer: UIPanGestureRecognizer) {
    let target = paintMode == "support" ? highlightNode : paintMode == "model" ? modelNode : nil
    if recognizer.state == .began { clearStroke() }
    if let target, recognizer.state == .began || recognizer.state == .changed {
      let location = recognizer.location(in: scnView)
      let hits = scnView.hitTest(location, options: [.searchMode: SCNHitTestSearchMode.all.rawValue, .rootNode: target, .ignoreHiddenNodes: true])
      for hit in hits where hit.node === target {
        let point = hit.node.convertPosition(hit.localCoordinates, to: frameNode)
        // Only what the cut box shows can be painted.
        if !inBox(point) { continue }
        if let last = stroke.last, simd_distance(SIMD3<Float>(last.x, last.y, last.z), SIMD3<Float>(point.x, point.y, point.z)) < 0.08 { break }
        stroke.append(point)
        let dot = SCNNode(geometry: strokeDot)
        dot.position = point
        dot.renderingOrder = 12
        strokeNode.addChildNode(dot)
        break
      }
    }
    if recognizer.state == .ended || recognizer.state == .cancelled {
      if !stroke.isEmpty {
        onPaintStroke(["points": stroke.flatMap { [Double($0.x), Double($0.y), Double($0.z)] }])
      }
      clearStroke()
    }
  }

  private lazy var strokeDot: SCNGeometry = {
    let sphere = SCNSphere(radius: 0.18)
    let paint = SCNMaterial()
    paint.diffuse.contents = paintColor
    paint.lightingModel = .constant
    paint.readsFromDepthBuffer = false
    sphere.materials = [paint]
    return sphere
  }()

  private func inBox(_ point: SCNVector3) -> Bool {
    let x = Double(point.x), y = Double(point.y), z = Double(point.z)
    return x >= (clipMinX ?? -.infinity) && x <= (clipMaxX ?? .infinity) && y >= (clipMinY ?? -.infinity) && y <= (clipMaxY ?? .infinity)
      && z >= (clipLowMm ?? -.infinity) && z <= (clipHighMm ?? .infinity)
  }

  /// Two fingers turn the view about its target while painting.
  @objc private func orbited(_ recognizer: UIPanGestureRecognizer) {
    let move = recognizer.translation(in: scnView)
    recognizer.setTranslation(.zero, in: scnView)
    scnView.defaultCameraController.rotateBy(x: Float(move.x) * 0.5, y: Float(-move.y) * 0.5)
  }

  /// A pinch zooms while painting.
  @objc private func zoomed(_ recognizer: UIPinchGestureRecognizer) {
    let scale = recognizer.scale
    recognizer.scale = 1
    scnView.defaultCameraController.dolly(by: Float(scale - 1) * 40, onScreenPoint: recognizer.location(in: scnView), viewport: scnView.bounds.size)
  }

  private func show(_ geometry: SCNGeometry) {
    geometry.materials = [material]
    let previous = modelNode?.geometry?.boundingBox
    modelNode?.removeFromParentNode()
    let node = SCNNode(geometry: geometry)
    frameNode.addChildNode(node)
    modelNode = node
    applyOpacity()

    // A finer level of the same model has the same bounds: keep the owner's view.
    let (low, high) = geometry.boundingBox
    if let previous, ModelViewerView.near(previous.min, low), ModelViewerView.near(previous.max, high) { return }

    // Frame the whole model: its bounding sphere fills the view, seen from the front and a little above.
    let (center, radius) = node.boundingSphere
    let middle = node.convertPosition(center, to: scene.rootNode)
    let distance = Float(radius) / tan(Float(20.0 * Double.pi / 180)) * 1.1
    let tilt: Float = 0.45
    cameraNode.camera?.zNear = Double(max(0.1, distance - radius * 2))
    cameraNode.camera?.zFar = Double(distance + radius * 2)
    cameraNode.position = SCNVector3(middle.x, middle.y + distance * sin(tilt), middle.z + distance * cos(tilt))
    cameraNode.look(at: middle)
    scnView.pointOfView = cameraNode
    scnView.defaultCameraController.target = middle
  }

  private static func near(_ a: SCNVector3, _ b: SCNVector3) -> Bool {
    abs(a.x - b.x) < 1 && abs(a.y - b.y) < 1 && abs(a.z - b.z) < 1
  }

  /// The model as SceneKit geometry, with a normal per vertex from the triangles around it. Nil when the data is not a model.
  static func geometry(from data: Data) -> SCNGeometry? {
    let fixed = 48
    guard data.count >= fixed, data.prefix(4) == Data("SLMS".utf8) else { return nil }
    func u32(_ at: Int) -> UInt32 { data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: at, as: UInt32.self).littleEndian } }
    func f32(_ at: Int) -> Float { Float(bitPattern: u32(at)) }
    guard u32(4) == 2 else { return nil }
    let vertexCount = Int(u32(8))
    let triangleCount = Int(u32(12))
    let low = SIMD3<Float>(f32(16), f32(20), f32(24))
    let span = SIMD3<Float>(f32(28), f32(32), f32(36)) - low
    let positionBytes = vertexCount * 6
    let indexStart = fixed + positionBytes + (4 - positionBytes % 4) % 4
    guard vertexCount > 0, triangleCount > 0, data.count == indexStart + triangleCount * 12 else { return nil }

    var positions = [SIMD3<Float>](repeating: .zero, count: vertexCount)
    var indices = [UInt32](repeating: 0, count: triangleCount * 3)
    data.withUnsafeBytes { raw in
      for v in 0..<vertexCount {
        let at = fixed + v * 6
        let q = SIMD3<Float>(
          Float(raw.loadUnaligned(fromByteOffset: at, as: UInt16.self).littleEndian),
          Float(raw.loadUnaligned(fromByteOffset: at + 2, as: UInt16.self).littleEndian),
          Float(raw.loadUnaligned(fromByteOffset: at + 4, as: UInt16.self).littleEndian)
        )
        positions[v] = low + q / 65535 * span
      }
      for i in 0..<(triangleCount * 3) {
        indices[i] = raw.loadUnaligned(fromByteOffset: indexStart + i * 4, as: UInt32.self).littleEndian
      }
    }
    guard indices.allSatisfy({ Int($0) < vertexCount }) else { return nil }

    // Each vertex's normal: the sum of its triangles' normals, which weights each by its area.
    var normals = [SIMD3<Float>](repeating: .zero, count: vertexCount)
    for t in 0..<triangleCount {
      let a = Int(indices[t * 3]), b = Int(indices[t * 3 + 1]), c = Int(indices[t * 3 + 2])
      let n = simd_cross(positions[b] - positions[a], positions[c] - positions[a])
      normals[a] += n
      normals[b] += n
      normals[c] += n
    }
    for v in 0..<vertexCount {
      let length = simd_length(normals[v])
      normals[v] = length > 0 ? normals[v] / length : SIMD3<Float>(0, 0, 1)
    }

    let stride = MemoryLayout<Float>.size * 3
    // SIMD3 holds 4 floats; SceneKit takes 3 per vertex, packed.
    let packed = { (vectors: [SIMD3<Float>]) -> Data in
      var floats = [Float](repeating: 0, count: vectors.count * 3)
      for (v, value) in vectors.enumerated() {
        floats[v * 3] = value.x
        floats[v * 3 + 1] = value.y
        floats[v * 3 + 2] = value.z
      }
      return floats.withUnsafeBufferPointer { Data(buffer: $0) }
    }
    let positionData = packed(positions)
    let normalData = packed(normals)
    let vertexSource = SCNGeometrySource(data: positionData, semantic: .vertex, vectorCount: vertexCount, usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: stride)
    let normalSource = SCNGeometrySource(data: normalData, semantic: .normal, vectorCount: vertexCount, usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: stride)
    let element = SCNGeometryElement(data: indices.withUnsafeBufferPointer { Data(buffer: $0) }, primitiveType: .triangles, primitiveCount: triangleCount, bytesPerIndex: 4)
    return SCNGeometry(sources: [vertexSource, normalSource], elements: [element])
  }

  /// A colour from `#rrggbb` or `#rrggbbaa`; light grey for anything else.
  static func color(hex: String) -> UIColor {
    var text = hex.trimmingCharacters(in: .whitespaces)
    if text.hasPrefix("#") { text.removeFirst() }
    guard text.count == 6 || text.count == 8, let value = UInt64(text, radix: 16) else { return UIColor(white: 0.85, alpha: 1) }
    let rgba = text.count == 6 ? (value << 8) | 0xff : value
    return UIColor(
      red: CGFloat((rgba >> 24) & 0xff) / 255,
      green: CGFloat((rgba >> 16) & 0xff) / 255,
      blue: CGFloat((rgba >> 8) & 0xff) / 255,
      alpha: CGFloat(rgba & 0xff) / 255
    )
  }
}
