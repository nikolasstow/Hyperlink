import ExpoModulesCore

public class ContextMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ContextMenu")

    View(ContextMenuView.self) {
      Events("onAction")

      Prop("actions") { (view: ContextMenuView, actions: [MenuAction]) in
        view.actions = actions
      }

      Prop("previewCornerRadius") { (view: ContextMenuView, radius: Double) in
        view.previewCornerRadius = radius
      }
    }
  }
}
