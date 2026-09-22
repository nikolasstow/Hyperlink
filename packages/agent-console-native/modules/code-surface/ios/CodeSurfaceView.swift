import ExpoModulesCore
import UIKit
import WebKit

/**
 A React Native view that borrows a warm surface from ``SurfacePool``.

 It owns nothing. On mount it claims a web view that has already parsed the
 bundle and may already be holding documents, and on unmount it hands that web
 view straight back. That is the whole point: the expensive thing outlives the
 screen, which is the one thing React Native's own view tree cannot express.
 */
final class CodeSurfaceView: ExpoView, WKScriptMessageHandler {
  private var webView: WKWebView?
  private var fileURL: URL?
  private var handlerInstalled = false

  let onSurfaceMessage = EventDispatcher()

  /// The code surface page, as a `file://` URL. JavaScript resolves the Metro
  /// asset and passes it down, so the page is built in one place and shipped
  /// once rather than duplicated into the native bundle.
  var sourceUrl: String = "" {
    didSet {
      guard sourceUrl != oldValue, let url = URL(string: sourceUrl) else { return }
      fileURL = url
      attachIfNeeded()
    }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
  }

  private func attachIfNeeded() {
    guard webView == nil, let url = fileURL else { return }
    let claimed = SurfacePool.shared.claim(fileURL: url)
    // A pooled surface carries the handler from its previous tenant, so the old
    // one is removed before this view becomes the target. Adding twice throws.
    claimed.configuration.userContentController.removeScriptMessageHandler(forName: "codeSurface")
    claimed.configuration.userContentController.add(self, name: "codeSurface")
    handlerInstalled = true
    claimed.frame = bounds
    claimed.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(claimed)
    webView = claimed
  }

  private func detach() {
    guard let claimed = webView else { return }
    if handlerInstalled {
      claimed.configuration.userContentController.removeScriptMessageHandler(forName: "codeSurface")
      handlerInstalled = false
    }
    claimed.removeFromSuperview()
    SurfacePool.shared.release(claimed)
    webView = nil
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      // Off screen for good: give the surface back so the next file can have it
      // warm. Its documents survive, because the web view does.
      detach()
    } else {
      attachIfNeeded()
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    webView?.frame = bounds
  }

  /// Evaluate one host message inside the surface. The script is built by
  /// `codeSurfaceProtocol.ts`, the same string the WebView host injects.
  func send(script: String) {
    webView?.evaluateJavaScript(script, completionHandler: nil)
  }

  func userContentController(
    _ controller: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard let body = message.body as? String else { return }
    onSurfaceMessage(["data": body])
  }

  deinit {
    detach()
  }
}
