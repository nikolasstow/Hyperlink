import ExpoModulesCore

public class VariableBlurModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VariableBlur")

    // Version of the SwiftUI blur support, so JS can gate on it. v2 adds the
    // `coreFeatures: ["swiftui"]` config that hosts the view as a proper Host
    // child; v1 (no coreFeatures) mounted it as a plain UIView and must stay
    // off. JS requires >= 2.
    Constants([
      "swiftUIBlurVersion": 2
    ])

    // SwiftUI variant, usable inside an @expo/ui Host. Props bind via @Field.
    View(VariableBlurSwiftUIView.self)

    View(VariableBlurView.self) {
      Prop("blurRadius") { (view: VariableBlurView, radius: Double) in
        view.maxBlurRadius = radius
      }

      Prop("direction") { (view: VariableBlurView, direction: String) in
        switch direction {
        case "down", "blurredBottomClearTop":
          view.direction = .blurredBottomClearTop
        default:
          // Status-bar feather: strongest blur at the top edge.
          view.direction = .blurredTopClearBottom
        }
      }
    }
  }
}
