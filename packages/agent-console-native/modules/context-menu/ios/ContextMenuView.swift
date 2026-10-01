import ExpoModulesCore
import UIKit

/// One item of the menu.
struct MenuAction: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var systemImage: String?
  @Field var destructive: Bool = false
}

/// A plain view (laid out by React Native like any other) that opens the iOS
/// context menu on a long press: the view lifts out of the screen, the rest
/// blurs, and the menu shows the given actions. The lifted preview is the view
/// itself, clipped to `previewCornerRadius`.
public final class ContextMenuView: ExpoView, UIContextMenuInteractionDelegate {
  var actions: [MenuAction] = []
  var previewCornerRadius: Double = 0
  let onAction = EventDispatcher()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addInteraction(UIContextMenuInteraction(delegate: self))
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    guard !actions.isEmpty else { return nil }
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
      guard let self else { return nil }
      return UIMenu(children: self.actions.map { action in
        UIAction(
          title: action.title,
          image: action.systemImage.flatMap { UIImage(systemName: $0) },
          attributes: action.destructive ? .destructive : []
        ) { [weak self] _ in
          self?.onAction(["id": action.id])
        }
      })
    }
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    previewForHighlightingMenuWithConfiguration configuration: UIContextMenuConfiguration
  ) -> UITargetedPreview? {
    targetedPreview()
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    previewForDismissingMenuWithConfiguration configuration: UIContextMenuConfiguration
  ) -> UITargetedPreview? {
    targetedPreview()
  }

  private func targetedPreview() -> UITargetedPreview {
    let parameters = UIPreviewParameters()
    parameters.backgroundColor = .clear
    parameters.visiblePath = UIBezierPath(roundedRect: bounds, cornerRadius: CGFloat(previewCornerRadius))
    return UITargetedPreview(view: self, parameters: parameters)
  }
}
