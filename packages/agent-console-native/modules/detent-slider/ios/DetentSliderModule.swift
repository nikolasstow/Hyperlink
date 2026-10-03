import ExpoModulesCore

public class DetentSliderModule: Module {
  public func definition() -> ModuleDefinition {
    // V2: the first version's event was `onChange`, which React Native already
    // has as a bubbling event, so rendering it threw ("Event cannot be both
    // direct and bubbling: topChange"). A new name, so a build that still has
    // the first version finds no module and the caller falls back.
    Name("DetentSliderV2")

    View(DetentSliderView.self) {
      Events("onValueChange")

      Prop("stops") { (view: DetentSliderView, stops: [Double]) in
        view.model.stops = stops.sorted()
      }

      Prop("value") { (view: DetentSliderView, value: Double) in
        view.model.value = value
      }
    }
  }
}
