import ExpoModulesCore

public class PrinterPipModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PrinterPip")

    View(PrinterPipView.self) {
      Prop("mode") { (view: PrinterPipView, mode: String) in
        view.mode = mode == "camera" ? .camera : .layer
      }
      Prop("cameraUrl") { (view: PrinterPipView, url: String?) in
        view.cameraUrl = url.flatMap(URL.init(string:))
      }
      Prop("layerUri") { (view: PrinterPipView, uri: String?) in
        view.layerUri = uri.flatMap(URL.init(string:))
      }
      Prop("tint") { (view: PrinterPipView, hex: String?) in
        view.tint = PrinterPipView.color(hex: hex ?? "")
      }
      Prop("aspect") { (view: PrinterPipView, aspect: Double) in
        view.aspect = aspect > 0 ? CGFloat(aspect) : 16.0 / 9.0
      }
      Prop("enabled") { (view: PrinterPipView, enabled: Bool) in
        view.enabled = enabled
      }
    }
  }
}
