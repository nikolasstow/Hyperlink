import ExpoModulesCore
import SwiftUI

/// One session row's display data, sent from JS (the view never fetches).
struct DubzSessionRecord: Record {
    @Field var id: String = ""
    @Field var title: String = ""
    @Field var subtitle: String?
    @Field var updated: Double = 0
    @Field var directory: String = ""
    @Field var count: Int = 0
    @Field var unread: Bool = false
    @Field var muted: Bool = false
}

public final class DubzHomeProps: ExpoSwiftUI.ViewProps {
    @Field var sessions: [DubzSessionRecord] = []
    @Field var contentWidth: Double = 0
    @Field var topInset: Double = 0
    @Field var bottomInset: Double = 0
    @Field var leftInset: Double = 0
    @Field var compact: Bool = false
    @Field var labelColor: Color?
    @Field var secondaryColor: Color?
    @Field var light: Bool?
    /** DEV: draw a border around the real content, so the outline matches it. */
    @Field var debug: Bool = false
    var onOpenSession = EventDispatcher()
    var onViewAll = EventDispatcher()
    var onActiveHeight = EventDispatcher()
}

public class DubzHomeModule: Module {
    public func definition() -> ModuleDefinition {
        Name("DubzHome")

        // JS gates on this: a binary without apiVersion >= 1 falls back to the
        // @expo/ui suggestions. Bump it when the contract/events change.
        // 1: the suggestions surface — native scroll, bottom-anchor,
        //    scroll-behind, expand, row animation (session area as content).
        Constants([
            "apiVersion": 1,
        ])

        View(DubzHomeView.self)
    }
}

// Layout constants, matching the @expo/ui version (DubzSessions.tsx).
private let PILL: CGFloat = 44
private let GAP: CGFloat = 8
private let NUMBER_WIDTH: CGFloat = 60
/// How many extra sessions the expand reveals.
private let EXTRA = 4

/// Dubz home's suggestions surface. A bottom-anchored ScrollView that fills the
/// window and scrolls BEHIND the top and bottom bars (contentMargins by the
/// insets) — the thing the flipped @expo/ui List could not do. The main session
/// pill rests on the composer pill; tapping the number pill expands the extra
/// sessions and the + / View All row in above it, and reports the height Dubz
/// should grow to while expanded.
public struct DubzHomeView: ExpoSwiftUI.View {
    @ObservedObject public var props: DubzHomeProps
    @State private var expanded = false

    public init(props: DubzHomeProps) {
        self.props = props
    }

    private var label: Color { props.labelColor ?? .primary }
    private var secondary: Color { props.secondaryColor ?? .secondary }
    private var leftGap: CGFloat { CGFloat(props.leftInset) }
    private var rowWidth: CGFloat { CGFloat(props.contentWidth) - leftGap }

    private var extras: [DubzSessionRecord] {
        guard expanded, props.sessions.count > 1 else { return [] }
        return Array(props.sessions.dropFirst().prefix(EXTRA))
    }

    public var body: some View {
        ScrollView(showsIndicators: false) {
            // Top → bottom: the + / View All row, the extra sessions, then the
            // main row — so the main pill rests at the bottom (on the composer
            // pill) and the rest reveal above it.
            VStack(alignment: .leading, spacing: GAP) {
                if expanded {
                    actionsRow
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    ForEach(extras, id: \.id) { session in
                        sessionPill(session, width: rowWidth)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                if let top = props.sessions.first {
                    HStack(spacing: GAP) {
                        sessionPill(top, width: rowWidth - NUMBER_WIDTH - GAP)
                        numberPill(count: top.count)
                    }
                }
            }
            .frame(width: rowWidth, alignment: .leading)
            .padding(.leading, leftGap)
            // Measure the REAL content height (not a row estimate) and report it.
            .background(GeometryReader { proxy in
                Color.clear.preference(key: ContentHeightKey.self, value: proxy.size.height)
            })
            // DEBUG: a border drawn ON the content, so the outline matches it.
            .border(props.debug ? Color.green : Color.clear, width: props.debug ? 1 : 0)
        }
        .modifier(BottomAnchoredScrollBehind(top: CGFloat(props.topInset), bottom: CGFloat(props.bottomInset)))
        .onPreferenceChange(ContentHeightKey.self) { height in
            props.onActiveHeight(["height": Double(props.sessions.isEmpty ? 0 : height)])
        }
    }

    // MARK: - Rows

    private func sessionPill(_ session: DubzSessionRecord, width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(session.title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(label)
                .lineLimit(1)
            if let subtitle = session.subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(secondary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 14)
        .frame(width: max(width, PILL), height: PILL, alignment: .leading)
        .modifier(GlassCapsule())
        .contentShape(Capsule())
        .onTapGesture { props.onOpenSession(["id": session.id]) }
    }

    private func numberPill(count: Int) -> some View {
        HStack(spacing: 4) {
            if expanded {
                Image(systemName: "chevron.down")
            } else {
                Image(systemName: "bubble.left.and.bubble.right")
                Text("\(max(count, 0))")
                    .font(.system(size: 14, weight: .semibold))
            }
        }
        .foregroundStyle(label)
        .frame(width: NUMBER_WIDTH, height: PILL)
        .modifier(GlassCapsule())
        .contentShape(Capsule())
        .onTapGesture {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { expanded.toggle() }
        }
    }

    private var actionsRow: some View {
        HStack(spacing: GAP) {
            Image(systemName: "plus")
                .foregroundStyle(label)
                .frame(width: PILL, height: PILL)
                .modifier(GlassCapsule())
            HStack(spacing: 6) {
                Text("View All")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(label)
                    .lineLimit(1)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13))
                    .foregroundStyle(secondary)
            }
            .padding(.horizontal, 16)
            .frame(height: PILL)
            .modifier(GlassCapsule())
            .contentShape(Capsule())
            .onTapGesture { props.onViewAll([:]) }
        }
    }
}

/// Carries the measured content height out of the layout so the view can report
/// its REAL height (not a row estimate) to JS.
private struct ContentHeightKey: PreferenceKey {
    static var defaultValue: CGFloat { 0 }
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

/// Bottom-anchor the scroll (newest/main at the bottom) and let content scroll
/// BEHIND the top and bottom bars (contentMargins by the insets). These are
/// iOS 17+ APIs and the module builds against a 15.0 floor, so guard them — the
/// app runs iOS 26, so it always takes this path.
private struct BottomAnchoredScrollBehind: ViewModifier {
    let top: CGFloat
    let bottom: CGFloat
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content
                .defaultScrollAnchor(.bottom)
                .contentMargins(.top, top, for: .scrollContent)
                .contentMargins(.bottom, bottom, for: .scrollContent)
        } else {
            content
        }
    }
}

/// Regular glass in a capsule, matching the @expo/ui pills — guarded for the
/// iOS 26 / Swift 6.2 glass API, with a material fallback.
private struct GlassCapsule: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
#if compiler(>=6.2)
            content.glassEffect(Glass.regular.interactive(), in: Capsule())
#else
            content.background(Capsule().fill(.thinMaterial))
#endif
        } else {
            content.background(Capsule().fill(.thinMaterial))
        }
    }
}
