import UIKit
import WebKit

/// Watches one surface's page load so a failure is never silent.
///
/// `WKWebView.navigationDelegate` is weak and the load starts in the pool, long
/// before any view has claimed the surface, so the observer is owned by the
/// ``Surface`` and the failure is remembered as well as forwarded.
private final class SurfaceLoadObserver: NSObject, WKNavigationDelegate {
  weak var surface: Surface?

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    surface?.loaded()
  }

  func webView(
    _ webView: WKWebView,
    didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    surface?.failed(error.localizedDescription)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    surface?.failed(error.localizedDescription)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    surface?.failed("The code surface ran out of memory and was closed by iOS.")
  }
}

/// A web view that has loaded the code surface, and the content controller it
/// was built with.
///
/// The controller is held alongside deliberately. `WKWebView.configuration` is
/// `@NSCopying`, so reading it back hands you a copy: a script message handler
/// registered on `webView.configuration.userContentController` goes onto that
/// copy and never fires. The only controller that works is the one the web view
/// was created with, so it is kept here rather than fetched later.
final class Surface {
  let webView: WKWebView
  let controller: WKUserContentController
  private let observer = SurfaceLoadObserver()

  /// Why the page failed to load, if it did. Remembered rather than only
  /// announced, because the load begins in the pool and there may be no view
  /// listening yet.
  private(set) var failure: String?

  /// Told when the page fails, and told straight away if it already has.
  var onFailure: ((String) -> Void)? {
    didSet {
      if let failure { onFailure?(failure) }
    }
  }

  init(webView: WKWebView, controller: WKUserContentController) {
    self.webView = webView
    self.controller = controller
    observer.surface = self
    webView.navigationDelegate = observer
  }

  /// Load the page again, for a surface whose last attempt failed.
  func reload(fileURL: URL) {
    failure = nil
    webView.loadFileURL(fileURL, allowingReadAccessTo: fileURL.deletingLastPathComponent())
  }

  fileprivate func failed(_ reason: String) {
    failure = reason
    onFailure?(reason)
  }

  fileprivate func loaded() {
    failure = nil
  }
}

/// A pool of surfaces that have already loaded the page.
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
final class SurfacePool {
  static let shared = SurfacePool()

  /// The handler name the page's shim posts to. One name, used in both places.
  static let messageName = "codeSurface"

  private var idle: [Surface] = []
  private var busy: [Surface] = []

  /// Where a surface waits between screens.
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

  private func park(_ surface: Surface) {
    if parking.superview == nil, let window = Self.keyWindow() {
      window.addSubview(parking)
    }
    surface.webView.frame = parking.bounds
    parking.addSubview(surface.webView)
  }

  private static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }

  private func makeSurface(fileURL: URL) -> Surface {
    let controller = WKUserContentController()
    // The page talks to the host the same way it does under
    // `react-native-webview`, so the built asset needs no host-specific
    // variant. The shim is installed at document start, before the bundle runs.
    controller.addUserScript(
      WKUserScript(
        source: """
        window.ReactNativeWebView = {
          postMessage: function (message) {
            window.webkit.messageHandlers.\(Self.messageName).postMessage(String(message));
          }
        };
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
      )
    )

    let configuration = WKWebViewConfiguration()
    configuration.userContentController = controller
    configuration.suppressesIncrementalRendering = false
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true

    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.isOpaque = false
    webView.backgroundColor = .clear
    webView.scrollView.isScrollEnabled = false
    webView.scrollView.bounces = false
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    // Everything the page needs is inline, so read access to the file's own
    // directory is all it ever asks for.
    webView.loadFileURL(fileURL, allowingReadAccessTo: fileURL.deletingLastPathComponent())
    return Surface(webView: webView, controller: controller)
  }

  /// Bring the pool up to `count` warm surfaces. Safe to call more than once.
  func warm(count: Int, fileURL: URL) {
    let total = idle.count + busy.count
    guard total < count else { return }
    for _ in total..<count {
      let surface = makeSurface(fileURL: fileURL)
      park(surface)
      idle.append(surface)
    }
  }

  /// A warm surface, or a cold one if the pool was never warmed or is empty.
  func claim(fileURL: URL) -> Surface {
    let surface = idle.popLast() ?? makeSurface(fileURL: fileURL)
    // A surface whose page failed to load is not warm, it is broken. Hand back
    // one that is trying again rather than one that will never render.
    if surface.failure != nil { surface.reload(fileURL: fileURL) }
    surface.webView.removeFromSuperview()
    busy.append(surface)
    return surface
  }

  /// Take a surface back. It keeps its documents and its parsed bundle.
  func release(_ surface: Surface) {
    busy.removeAll { $0 === surface }
    guard !idle.contains(where: { $0 === surface }) else { return }
    park(surface)
    idle.append(surface)
  }
}
