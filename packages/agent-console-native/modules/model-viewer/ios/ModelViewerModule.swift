import ExpoModulesCore

public class ModelViewerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ModelViewer")

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
    }
  }
}
