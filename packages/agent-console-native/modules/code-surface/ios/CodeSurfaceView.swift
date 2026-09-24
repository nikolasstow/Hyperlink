import ExpoModulesCore
import UIKit
import WebKit

/**
 Forwards script messages without owning the thing it forwards to.

 `WKUserContentController` retains its message handlers. Registering the view
 itself would make a cycle the view can never escape, since the view holds the
 web view, which holds the controller, which would hold the view: `deinit` would
 never run and the surface would never go back to the pool. The proxy is what
 the controller retains, and it points back weakly.
 */
private final class MessageProxy: NSObject, WKScriptMessageHandler {
  weak var target: CodeSurfaceView?

  func userContentController(
    _ controller: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard let body = message.body as? String else { return }
    target?.receive(body)
  }
}

/**
 A React Native view that borrows a warm surface from ``SurfacePool``.

 It owns nothing. On mount it claims a web view that has already parsed the
 bundle and may already be holding documents, and on unmount it hands that web
 view straight back. That is the whole point: the expensive thing outlives the
 screen, which is the one thing React Native's own view tree cannot express.
 */
public final class CodeSurfaceView: ExpoView {
  private var surface: Surface?
  private var fileURL: URL?
  private let proxy = MessageProxy()

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

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    proxy.target = self
  }

  fileprivate func receive(_ body: String) {
    onSurfaceMessage(["data": body])
  }

  /// Tell the host the page is gone.
  ///
  /// `loadFailed` rather than `error`, because the two mean different things to
  /// the host: an `error` is the page reporting something it survived, and this
  /// is the page not being there at all. A web view whose content process died
  /// cannot report its own absence, so the failure comes from out here and is
  /// fatal whenever it arrives.
  private func report(failure reason: String) {
    guard
      let data = try? JSONSerialization.data(withJSONObject: ["kind": "loadFailed", "message": reason]),
      let json = String(data: data, encoding: .utf8)
    else { return }
    receive(json)
  }

  private func attachIfNeeded() {
    guard surface == nil, window != nil, let url = fileURL else { return }
    let claimed = SurfacePool.shared.claim(fileURL: url)
    // A pooled surface carries the handler its last tenant installed, and
    // adding a second under the same name throws, so the old one goes first.
    claimed.controller.removeScriptMessageHandler(forName: SurfacePool.messageName)
    claimed.controller.add(proxy, name: SurfacePool.messageName)
    // Set after the handler, and it fires immediately for a surface that has
    // already failed, so a claim of a broken surface is reported at once.
    claimed.onFailure = { [weak self] reason in self?.report(failure: reason) }
    claimed.webView.frame = bounds
    claimed.webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(claimed.webView)
    surface = claimed
  }

  private func detach() {
    guard let claimed = surface else { return }
    surface = nil
    claimed.onFailure = nil
    claimed.controller.removeScriptMessageHandler(forName: SurfacePool.messageName)
    claimed.webView.removeFromSuperview()
    SurfacePool.shared.release(claimed)
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      // Off screen for good: give the surface back so the next file can have it
      // warm. Its documents survive, because the web view does.
      detach()
    } else {
      attachIfNeeded()
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    surface?.webView.frame = bounds
  }

  /// Evaluate one host message inside the surface. The script is built by
  /// `codeSurfaceProtocol.ts`, the same string the WebView host injects.
  func send(script: String) {
    surface?.webView.evaluateJavaScript(script, completionHandler: nil)
  }

  deinit {
    // `didMoveToWindow` has normally returned the surface already. This covers
    // a view torn down without ever leaving a window, and runs on the main
    // thread because that is where a view in the hierarchy is released.
    detach()
  }
}
