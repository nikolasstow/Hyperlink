import ExpoModulesCore
import SwiftUI

/// One tab: its title, and an SF Symbol for a tab that collapses to it.
struct CapsuleTab: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var systemImage: String?
}

public final class CapsuleTabsProps: ExpoSwiftUI.ViewProps {
  @Field var tabs: [CapsuleTab] = []
  @Field var selection: String = ""
  @Field var tint: Color?
  @Field var sideMargin: Double = 20
  var onSelect = EventDispatcher()
}

/// A sideways-scrolling row of capsule tabs, the selected one on glass. A tab
/// with an icon collapses to it while another is selected: its title's frame
/// narrows to nothing, clipped, so the capsule shrinks around the icon. Every
/// change of selection, a tap here or a new `selection` from outside, springs.
public struct CapsuleTabsView: ExpoSwiftUI.View {
  @ObservedObject public var props: CapsuleTabsProps
  /// The selection shown, moved inside an animation.
  @State private var shown: String = ""

  private static let spring = Animation.spring(response: 0.3, dampingFraction: 0.85)

  public init(props: CapsuleTabsProps) {
    self.props = props
  }

  public var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(props.tabs, id: \.id) { tab in
          tabView(tab)
        }
      }
      .padding(.horizontal, props.sideMargin)
      .padding(.vertical, 14)
    }
    .onAppear { shown = props.selection }
    .onChange(of: props.selection) { selection in
      withAnimation(Self.spring) { shown = selection }
    }
  }

  private func tabView(_ tab: CapsuleTab) -> some View {
    let active = tab.id == shown
    let collapsed = tab.systemImage != nil && !active
    return HStack(spacing: 0) {
      if let icon = tab.systemImage {
        Image(systemName: icon)
      }
      Text(tab.title)
        .lineLimit(1)
        .fixedSize()
        .padding(.leading, tab.systemImage != nil ? 6 : 0)
        .frame(maxWidth: collapsed ? 0 : nil, alignment: .leading)
        .clipped()
    }
    .font(.system(size: 14, weight: active ? .semibold : .medium))
    .foregroundStyle(active ? HierarchicalShapeStyle.primary : HierarchicalShapeStyle.secondary)
    .padding(.horizontal, collapsed ? 10 : 14)
    .frame(height: 34)
    .modifier(SelectedGlass(active: active, tint: props.tint))
    .contentShape(Capsule())
    .onTapGesture {
      withAnimation(Self.spring) { shown = tab.id }
      props.onSelect(["id": tab.id])
    }
  }
}

/// Regular glass behind the selected tab, none behind the rest.
private struct SelectedGlass: ViewModifier {
  let active: Bool
  let tint: Color?

  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
#if compiler(>=6.2)
      content.glassEffect(active ? Glass.regular.tint(tint) : Glass.identity, in: Capsule())
#else
      content.background(Capsule().fill(.thinMaterial).opacity(active ? 1 : 0))
#endif
    } else {
      content.background(Capsule().fill(.thinMaterial).opacity(active ? 1 : 0))
    }
  }
}
