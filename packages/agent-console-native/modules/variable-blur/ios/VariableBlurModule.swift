import ExpoModulesCore

public class VariableBlurModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VariableBlur")

    // Lets JS detect that this build has the SwiftUI view before using it, so
    // older builds (without it) stay inert rather than rendering a missing view.
    Constants([
      "hasSwiftUIBlur": true
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
