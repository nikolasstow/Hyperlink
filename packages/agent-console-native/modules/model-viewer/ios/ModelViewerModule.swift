import ExpoModulesCore

public class ModelViewerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ModelViewer")

    // What this build of the view can do: the app keeps the old look on an older build.
    Constants(["paintPatches": true])

    // The model in AR (ModelAR.swift). Resolves once AR Quick Look is on screen.
    AsyncFunction("presentAR") { (uri: String, hex: String, clipLowMm: Double?, clipHighMm: Double?, title: String, promise: Promise) in
      guard let file = URL(string: uri) else {
        promise.reject("ERR_MODEL_AR", "Not a file URI: \(uri)")
        return
      }
      ModelAR.present(
        uri: file,
        color: ModelViewerView.color(hex: hex),
        clipLowMm: clipLowMm,
        clipHighMm: clipHighMm,
        title: title,
        from: { [weak self] in self?.appContext?.utilities?.currentViewController() },
        done: { error in
          if let error {
            promise.reject("ERR_MODEL_AR", String(describing: error))
          } else {
            promise.resolve()
          }
        }
      )
    }.runOnQueue(.main)

    View(ModelViewerView.self) {
      Prop("uri") { (view: ModelViewerView, uri: String?) in
        view.uri = uri.flatMap(URL.init(string:))
      }
      Prop("color") { (view: ModelViewerView, hex: String?) in
        view.modelColor = ModelViewerView.color(hex: hex ?? "")
      }
      Prop("clipLowMm") { (view: ModelViewerView, mm: Double?) in
        view.clipLowMm = mm
      }
      Prop("clipHighMm") { (view: ModelViewerView, mm: Double?) in
        view.clipHighMm = mm
      }
      Prop("supportsUri") { (view: ModelViewerView, uri: String?) in
        view.supportsUri = uri.flatMap(URL.init(string:))
      }
      Prop("supportsColor") { (view: ModelViewerView, hex: String?) in
        view.supportsColor = ModelViewerView.color(hex: hex ?? "#ff9f0a")
      }
      Prop("markers") { (view: ModelViewerView, markers: [ModelMarker]?) in
        view.markers = markers ?? []
      }
      Prop("highlightUri") { (view: ModelViewerView, uri: String?) in
        view.highlightUri = uri.flatMap(URL.init(string:))
      }
      Prop("highlightColor") { (view: ModelViewerView, hex: String?) in
        view.highlightColor = ModelViewerView.color(hex: hex ?? "#3399ff")
      }
      Prop("clipMinX") { (view: ModelViewerView, mm: Double?) in view.clipMinX = mm }
      Prop("clipMaxX") { (view: ModelViewerView, mm: Double?) in view.clipMaxX = mm }
      Prop("clipMinY") { (view: ModelViewerView, mm: Double?) in view.clipMinY = mm }
      Prop("clipMaxY") { (view: ModelViewerView, mm: Double?) in view.clipMaxY = mm }
      Prop("modelOpacity") { (view: ModelViewerView, value: Double?) in view.modelOpacity = value ?? 1 }
      Prop("supportsOpacity") { (view: ModelViewerView, value: Double?) in view.supportsOpacity = value ?? 1 }
      Prop("paintMode") { (view: ModelViewerView, mode: String?) in view.paintMode = mode ?? "off" }
      Prop("paintColor") { (view: ModelViewerView, hex: String?) in view.paintColor = ModelViewerView.color(hex: hex ?? "#ff3b30") }
      Prop("brushRadius") { (view: ModelViewerView, mm: Double?) in view.brushRadius = mm ?? 1 }
      Prop("patches") { (view: ModelViewerView, patches: [PaintPatchRecord]?) in view.patches = patches ?? [] }
      Events("onRayTap", "onPaintStroke")
    }
  }
}
