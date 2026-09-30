import ExpoModulesCore

public class CapsuleTabsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CapsuleTabs")

    View(CapsuleTabsView.self)
  }
}
