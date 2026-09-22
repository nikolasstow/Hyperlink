import UIKit
import WebKit

/// A pool of `WKWebView`s that have already loaded the code surface.
///
/// The page is five and a half megabytes of Monaco and Shiki, and parsing it
/// costs the better part of a second. React Native cannot move a native view
/// between parents, so a web view owned by a screen dies with that screen and
/// the next file pays the parse again. Here the web views outlive every screen:
/// a view claims one on mount and gives it back on unmount, and the web content
/// process is never torn down.
///
/// The reason this is worth native code at all is that a warm surface can be
/// handed documents *before* anyone opens them, which nothing owned by a screen
/// can do.
final class SurfacePool: NSObject {
  static let shared = SurfacePool()

  private var idle: [WKWebView] = []
  private var busy: [WKWebView] = []

  /// Where a web view waits between screens.
  ///
  /// It has to be in the window and it has to have a real size: WebKit stops
  /// rendering a view that is hidden or zero-sized, and a suspended content
  /// process is exactly the warmth this pool exists to keep. So the container
  /// sits off the left edge of the screen at a normal size instead.
  private lazy var parking: UIView = {
    let view = UIView(frame: CGRect(x: -10_000, y: -10_000, width: 390, height: 700))
    view.isUserInteractionEnabled = false
    return view
  }()

  private var parked = false

  private func park(_ webView: WKWebView) {
    if !parked, let window = Self.keyWindow() {
      window.addSubview(parking)
      parked = true
    }
    webView.frame = parking.bounds
    parking.addSubview(webView)
  }

  private static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }

  private func makeWebView(fileURL: URL) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    // The page talks to the host the same way it does under
    // `react-native-webview`, so the asset needs no host-specific build. The
    // shim is installed at document start, before the bundle runs.
    let shim = WKUserScript(
      source: """
      window.ReactNativeWebView = {
        postMessage: function (message) {
          window.webkit.messageHandlers.codeSurface.postMessage(String(message));
        }
      };
      """,
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    )
    configuration.userContentController.addUserScript(shim)
    configuration.suppressesIncrementalRendering = false
    if #available(iOS 14.0, *) {
      configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    }

    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.isOpaque = false
    webView.backgroundColor = .clear
    webView.scrollView.isScrollEnabled = false
    webView.scrollView.bounces = false
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    // Everything the page needs is inline, so read access to the file's own
    // directory is all it ever asks for.
    webView.loadFileURL(fileURL, allowingReadAccessTo: fileURL.deletingLastPathComponent())
    return webView
  }

  /// Bring the pool up to `count` warm surfaces. Safe to call more than once.
  func warm(count: Int, fileURL: URL) {
    let total = idle.count + busy.count
    guard total < count else { return }
    for _ in total..<count {
      let webView = makeWebView(fileURL: fileURL)
      park(webView)
      idle.append(webView)
    }
  }

  /// A warm surface, or a cold one if the pool was never warmed or is empty.
  func claim(fileURL: URL) -> WKWebView {
    let webView = idle.popLast() ?? makeWebView(fileURL: fileURL)
    webView.removeFromSuperview()
    busy.append(webView)
    return webView
  }

  /// Take a surface back. It keeps its documents and its parsed bundle.
  func release(_ webView: WKWebView) {
    busy.removeAll { $0 === webView }
    guard !idle.contains(where: { $0 === webView }) else { return }
    park(webView)
    idle.append(webView)
  }
}
