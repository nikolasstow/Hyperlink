import ExpoModulesCore

public class PrinterPipModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PrinterPip")

    View(PrinterPipView.self) {
      Prop("mode") { (view: PrinterPipView, mode: String) in
        view.pageMode = mode == "camera" ? .camera : .layer
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
      Prop("phase") { (view: PrinterPipView, phase: String?) in
        view.phase = phase
      }
      Prop("exposing") { (view: PrinterPipView, exposing: Bool) in
        view.exposing = exposing
      }
      Prop("active") { (view: PrinterPipView, active: Bool) in
        view.active = active
      }
      Prop("glowColor") { (view: PrinterPipView, hex: String?) in
        view.glowColor = PrinterPipView.color(hex: hex ?? "")
      }
      Prop("phaseColor") { (view: PrinterPipView, hex: String?) in
        view.phaseColor = PrinterPipView.color(hex: hex ?? "")
      }
      Prop("dotColor") { (view: PrinterPipView, hex: String?) in
        view.dotColor = PrinterPipView.color(hex: hex ?? "")
      }
      Prop("percent") { (view: PrinterPipView, percent: Double?) in
        view.percent = percent
      }
      Prop("progressColors") { (view: PrinterPipView, hexes: [String]) in
        view.progressColors = hexes.map { PrinterPipView.color(hex: $0) }
      }
      Prop("elapsedMs") { (view: PrinterPipView, ms: Double?) in
        view.elapsedMs = ms
      }
      Prop("remainingMs") { (view: PrinterPipView, ms: Double?) in
        view.remainingMs = ms
      }
      Prop("enabled") { (view: PrinterPipView, enabled: Bool) in
        view.enabled = enabled
      }
    }
  }
}
