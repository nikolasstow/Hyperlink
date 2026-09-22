import ExpoModulesCore

/**
 The native host for the Monaco code surface.

 `warm` builds surfaces before anyone asks for one; the view claims and returns
 them. See ``SurfacePool`` for why the web views outlive the screens.
 */
public class CodeSurfaceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CodeSurface")

    /// Bring the pool up to `count` warm surfaces, loading `sourceUrl` into any
    /// it has to build. Called when the file tree opens rather than at launch,
    /// so nobody who never opens a file pays for it. Idempotent.
    AsyncFunction("warm") { (count: Int, sourceUrl: String) in
      guard let url = URL(string: sourceUrl) else {
        throw Exception(name: "CodeSurface", description: "warm needs a file URL, got \(sourceUrl)")
      }
      SurfacePool.shared.warm(count: max(0, min(count, 4)), fileURL: url)
    }.runOnQueue(.main)

    View(CodeSurfaceView.self) {
      Events("onSurfaceMessage")

      Prop("sourceUrl") { (view: CodeSurfaceView, url: String) in
        view.sourceUrl = url
      }

      AsyncFunction("send") { (view: CodeSurfaceView, script: String) in
        view.send(script: script)
      }.runOnQueue(.main)
    }
  }
}
