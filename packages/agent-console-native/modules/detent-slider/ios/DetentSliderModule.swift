import ExpoModulesCore

public class DetentSliderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DetentSlider")

    View(DetentSliderView.self) {
      Events("onChange")

      Prop("stops") { (view: DetentSliderView, stops: [Double]) in
        view.model.stops = stops.sorted()
      }

      Prop("value") { (view: DetentSliderView, value: Double) in
        view.model.value = value
      }
    }
  }
}
