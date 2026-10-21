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
    // --- Part B: the composer bottom bar (apiVersion 2) ---
    /** Render the composer as the bottom bar inside this view (Part B). Off by
     * default so an apiVersion-1 consumer (suggestions only) is unchanged. */
    @Field var showComposer: Bool = false
    /** Render ONLY the composer row (no scroll, no glass), for the RN pill to
     * wrap — validates the native composer in the existing window. */
    @Field var composerOnly: Bool = false
    /** Render the WHOLE Dubz window — glass + suggestions (Part A) + composer
     * (Part B) — bottom-anchored in the view's frame, sizing the glass to its
     * content in one SwiftUI pass (the all-native window). */
    @Field var window: Bool = false
    /** The floor the open window rests at (the user's dragged default), and the
     * cap (space above the keyboard). The glass sizes between them to content. */
    @Field var minHeight: Double = 0
    @Field var maxHeight: Double = 0
    /** Clear glass (the window) vs regular (collapsed bar). */
    @Field var clearGlass: Bool = true
    /** Tint the window glass (hex at runtime). */
    @Field var tint: Color?
    /** Seed text to restore a saved draft; typing is owned natively after. */
    @Field var draft: String = ""
    @Field var placeholder: String = ""
    /** Focus the field (the window is open). */
    @Field var open: Bool = false
    /** Chip tints (hex at runtime), from composerChips' SSOT so the bars match. */
    @Field var plusFill: Color?
    @Field var plusIcon: Color?
    @Field var sendActiveFill: Color?
    @Field var sendMutedFill: Color?
    var onOpenSession = EventDispatcher()
    var onViewAll = EventDispatcher()
    var onActiveHeight = EventDispatcher()
    /** Send the composed text (carried in the event, so JS need not mirror every
     * keystroke). JS clears its draft and sends through the outbox. */
    var onSend = EventDispatcher()
    /** Draft changed — JS mirrors it to persist across close (not per-send). */
    var onDraftChange = EventDispatcher()
    /** The + (attach) chip tapped. */
    var onPlus = EventDispatcher()
    /** The collapsed bar tapped — JS opens the window. */
    var onOpenComposer = EventDispatcher()
    /** The window was dragged down past its minimum — JS closes it. */
    var onClose = EventDispatcher()
}

public class DubzHomeModule: Module {
    public func definition() -> ModuleDefinition {
        Name("DubzHome")

        // JS gates on this: a binary without apiVersion >= 1 falls back to the
        // @expo/ui suggestions. Bump it when the contract/events change.
        // 1: the suggestions surface — native scroll, bottom-anchor,
        //    scroll-behind, expand, row animation (session area as content).
        // 2: + the composer bottom bar (Part B) can live in this view, so the
        //    window content (scroll + composer) is one native layout. Gated on
        //    `showComposer`; dormant until JS wires it.
        // 3: + composerOnly — the composer row alone, for the RN pill to wrap,
        //    so the native composer is usable in the existing window.
        // 4: + window — the WHOLE Dubz window (glass + Part A + Part B) as one
        //    self-sizing SwiftUI view that morphs collapsed bar ↔ open window.
        // 5: window canvas BOUNDED — v4's window laid out an infinite frame and
        //    froze the UI; the RN canvas now has a finite height.
        // 6: window hugs content via a plain VStack (no greedy ScrollView +
        //    GeometryReader loop, which still froze the UI in v5); real sessions.
        // 7: window STRIPPED to the floating composer bar (fixedSize, no fill)
        //    + an RN canvas sized to it, to nail touch pass-through / self-size
        //    / keyboard before layering suggestions + open/close back on.
        // 8: + the RESIZABLE glass window — open shows a glass panel whose height
        //    is a drag-driven @State (fixed per frame, so a bounded ScrollView
        //    can't loop), grabber to resize, drag-down-to-close.
        Constants([
            "apiVersion": 8,
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
// Composer (Part B), matching composerBarSpec.ts / composerChips.tsx.
private let COMPOSER_CHIP: CGFloat = 32
private let COMPOSER_SEND: CGFloat = 38
private let COMPOSER_FIELD_PADDING: CGFloat = 10
private let INPUT_MAX_LINES = 8
// The whole-window glass: inner padding and corner radius (match BarWindow).
private let WINDOW_PAD: CGFloat = 12
private let WINDOW_RADIUS: CGFloat = 30
// The open window's smallest drag height; below it a release closes Dubz.
private let OPEN_MIN: CGFloat = 140
private let OPEN_DEFAULT: CGFloat = 300

/// Dubz home's suggestions surface. A bottom-anchored ScrollView that fills the
/// window and scrolls BEHIND the top and bottom bars (contentMargins by the
/// insets) — the thing the flipped @expo/ui List could not do. The main session
/// pill rests on the composer pill; tapping the number pill expands the extra
/// sessions and the + / View All row in above it, and reports the height Dubz
/// should grow to while expanded.
public struct DubzHomeView: ExpoSwiftUI.View {
    @ObservedObject public var props: DubzHomeProps
    @State private var expanded = false
    // Part B owns the input text natively, so typing never round-trips to JS
    // (seeded from props.draft to restore a saved draft).
    @State private var text = ""
    @FocusState private var composerFocused: Bool
    // The open window's drag-driven height (remembered across open/close). The
    // drag sets it; the glass is this tall; a bounded ScrollView fills the
    // middle (fixed height → no self-sizing loop).
    @State private var windowHeight: CGFloat = OPEN_DEFAULT
    @State private var dragStartHeight: CGFloat = OPEN_DEFAULT
    @State private var isDragging = false

    public init(props: DubzHomeProps) {
        self.props = props
    }

    private var openMax: CGFloat { props.maxHeight > 0 ? CGFloat(props.maxHeight) : 500 }
    private var clampedHeight: CGFloat { min(max(windowHeight, OPEN_MIN), openMax) }

    private var label: Color { props.labelColor ?? .primary }
    private var secondary: Color { props.secondaryColor ?? .secondary }
    private var leftGap: CGFloat { CGFloat(props.leftInset) }
    private var rowWidth: CGFloat { CGFloat(props.contentWidth) - leftGap }

    private var extras: [DubzSessionRecord] {
        guard expanded, props.sessions.count > 1 else { return [] }
        return Array(props.sessions.dropFirst().prefix(EXTRA))
    }

    public var body: some View {
        if props.window {
            // The WHOLE Dubz window, all native: one glass that morphs between
            // the collapsed composer bar and the open window as its frame
            // animates (SwiftUI re-samples the glass itself — move-together).
            windowBody
        } else if props.composerOnly {
            // Part B alone, to validate the native composer in the existing RN
            // pill (the pill supplies the glass). It reports its natural height
            // so the window floor grows with the input — the same contract the
            // RN TextInput had via onContentSizeChange.
            composerOnlyBody
        } else {
            // Part A (scroll content + top bar) over Part B (the composer), one
            // native layout so they size together. Part B is gated (dormant)
            // until JS wires it; showComposer false → only Part A renders.
            VStack(spacing: GAP) {
                scrollContent
                if props.showComposer {
                    composerBar
                        // DEBUG: Part B's border, drawn on the real bar.
                        .border(props.debug ? Color.blue : Color.clear, width: props.debug ? 1 : 0)
                }
            }
        }
    }

    @ViewBuilder
    private var composerOnlyBody: some View {
        if #available(iOS 17.0, *) {
            composerRow
                .frame(maxWidth: .infinity)
                // Measure the natural row height (unconstrained) and report it
                // + the pill's chrome, so JS sets the window floor to it.
                .background(GeometryReader { proxy in
                    Color.clear.preference(key: ContentHeightKey.self, value: proxy.size.height)
                })
                .border(props.debug ? Color.blue : Color.clear, width: props.debug ? 1 : 0)
                .onPreferenceChange(ContentHeightKey.self) { height in
                    props.onActiveHeight(["height": Double(height + COMPOSER_FIELD_PADDING * 2)])
                }
        } else {
            EmptyView()
        }
    }

    // The session rows, top → bottom: the + / View All row, the extra sessions,
    // then the main row — so the main pill rests at the bottom (on the composer)
    // and the rest reveal above it. A plain VStack (sizes to content); the
    // window uses it directly, no ScrollView.
    private var suggestionRows: some View {
        VStack(alignment: .leading, spacing: GAP) {
            if expanded {
                actionsRow
                ForEach(extras, id: \.id) { session in
                    sessionPill(session, width: rowWidth)
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
    }

    // Part A for the non-window modes: the rows in a bottom-anchored scroll that
    // measures and reports its content height. NOTE: do NOT use this in the
    // self-sizing window — a greedy ScrollView + its GeometryReader form a layout
    // feedback loop there and freeze the UI. The window uses suggestionRows.
    private var scrollContent: some View {
        ScrollView(showsIndicators: false) {
            suggestionRows
                // Measure the REAL content height (not a row estimate) and report.
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

    // MARK: - Part B: the composer

    private var sendReady: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func send() {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        props.onSend(["text": body])
        text = ""
    }

    // The composer uses TextField(axis:)/lineLimit(range) (iOS 16) and the
    // two-param onChange (iOS 17); the module builds against a 15.0 floor, so
    // gate the whole bar. The app runs iOS 26 — it always takes the real path.
    @ViewBuilder
    private var composerBar: some View {
        if #available(iOS 17.0, *) {
            composerBarImpl
        } else {
            EmptyView()
        }
    }

    // The chips + field row. No glass/padding — the caller supplies them (the
    // RN pill when composerOnly; GlassCapsule in composerBar for the body).
    @available(iOS 17.0, *)
    private var composerRow: some View {
        HStack(alignment: .bottom, spacing: GAP) {
            Button { props.onPlus([:]) } label: {
                Image(systemName: "plus")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(props.plusIcon ?? .primary)
                    .frame(width: COMPOSER_CHIP, height: COMPOSER_CHIP)
            }
            .buttonStyle(.plain)
            .modifier(GlassCircle(tint: props.plusFill))
            // + is smaller than send; bottom-aligned, lift it to send's centre.
            .padding(.bottom, (COMPOSER_SEND - COMPOSER_CHIP) / 2)

            TextField(props.placeholder, text: $text, axis: .vertical)
                .lineLimit(1...INPUT_MAX_LINES)
                .font(.system(size: 16))
                .foregroundStyle(label)
                .tint(secondary)
                .focused($composerFocused)
                .disabled(!props.open)
                .frame(minHeight: COMPOSER_SEND, alignment: .center)
                // Hug the text height (grow with lines) — never expand to fill
                // the window, which made the input the whole glass.
                .fixedSize(horizontal: false, vertical: true)
                .onChange(of: text) { _, next in props.onDraftChange(["text": next]) }

            Button { send() } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: COMPOSER_SEND, height: COMPOSER_SEND)
            }
            .buttonStyle(.plain)
            .disabled(!sendReady)
            .modifier(GlassCircle(tint: sendReady ? props.sendActiveFill : props.sendMutedFill))
        }
        .onAppear { if text.isEmpty { text = props.draft } }
        .onChange(of: props.open) { _, isOpen in
            // Blur on close. Do NOT auto-focus on open — Dubz opens to its
            // suggestions and the keyboard raises on a tap on the field.
            if !isOpen { composerFocused = false }
        }
    }

    @available(iOS 17.0, *)
    private var composerBarImpl: some View {
        composerRow
            .padding(.horizontal, COMPOSER_FIELD_PADDING)
            .padding(.vertical, COMPOSER_FIELD_PADDING)
            .modifier(GlassCapsule())
    }

    // MARK: - The whole window (all native)
    //
    // STRIPPED to the hardest core (owner: "start with the hardest problems,
    // remove all other distractions"): a glass composer bar that
    //   1. floats over the TAPPABLE page — the RN canvas tracks this view's
    //      size (onLayoutContent) so everything outside it passes touches
    //      through; the view must size to its content, not fill;
    //   2. SIZES to its content (grows with lines) — fixedSize, no fill, no
    //      ScrollView, so no layout-loop freeze;
    //   3. rides the keyboard (the RN canvas is placed above it).
    // Suggestions, the open/close morph, the grabber and sessions layer on only
    // once this floats + self-sizes + stays tappable without freezing.
    @ViewBuilder
    private var windowBody: some View {
        if #available(iOS 17.0, *) {
            if props.open {
                resizableWindow
            } else {
                // Collapsed: the composer bar; a tap opens the window.
                composerBarImpl
                    .fixedSize(horizontal: false, vertical: true)
                    .border(props.debug ? Color.green : Color.clear, width: props.debug ? 1 : 0)
                    .contentShape(Rectangle())
                    .onTapGesture { props.onOpenComposer([:]) }
            }
        } else {
            EmptyView()
        }
    }

    // The RESIZABLE glass window: a glass panel whose height is the drag-driven
    // @State (fixed per frame, NOT self-sizing — so the inner ScrollView is
    // bounded and can't loop/freeze). The grabber drags the height; the glass
    // resizes natively; the RN canvas tracks it (onLayoutContent).
    @available(iOS 17.0, *)
    private var resizableContent: some View {
        VStack(spacing: GAP) {
            grabber
            ScrollView(showsIndicators: false) {
                suggestionRows.frame(maxWidth: .infinity, alignment: .leading)
            }
            .defaultScrollAnchor(.bottom)
            .frame(maxHeight: .infinity)
            composerBarImpl
        }
        .padding(WINDOW_PAD)
        .frame(width: CGFloat(props.contentWidth), height: clampedHeight)
    }

    @available(iOS 17.0, *)
    @ViewBuilder
    private var resizableWindow: some View {
        if #available(iOS 26.0, *) {
#if compiler(>=6.2)
            // The container is the shared sampling region so the composer pill
            // and chip glass can sit inside the window glass.
            GlassEffectContainer(spacing: GAP) {
                resizableContent
                    .glassEffect(Glass.regular, in: RoundedRectangle(cornerRadius: WINDOW_RADIUS))
            }
            .border(props.debug ? Color.green : Color.clear, width: props.debug ? 1 : 0)
#else
            resizableContent.background(RoundedRectangle(cornerRadius: WINDOW_RADIUS).fill(.ultraThinMaterial))
#endif
        } else {
            resizableContent.background(RoundedRectangle(cornerRadius: WINDOW_RADIUS).fill(.ultraThinMaterial))
        }
    }

    // Drag the grabber to resize (up = taller). Release below the minimum closes.
    @available(iOS 17.0, *)
    private var grabber: some View {
        Capsule()
            .fill(secondary.opacity(0.4))
            .frame(width: 40, height: 5)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture()
                    .onChanged { value in
                        if !isDragging {
                            isDragging = true
                            dragStartHeight = clampedHeight
                        }
                        windowHeight = dragStartHeight - value.translation.height
                    }
                    .onEnded { _ in
                        isDragging = false
                        if windowHeight < OPEN_MIN { props.onClose([:]) }
                        windowHeight = clampedHeight
                    }
            )
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

/// A tinted glass circle for the +/send chips, matching composerChips' glass
/// buttons — same guards as GlassCapsule, with a solid-tint fallback.
private struct GlassCircle: ViewModifier {
    let tint: Color?
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
#if compiler(>=6.2)
            let glass = tint.map { Glass.regular.tint($0).interactive() } ?? Glass.regular.interactive()
            content.glassEffect(glass, in: Circle())
#else
            content.background(Circle().fill(tint ?? Color.gray))
#endif
        } else {
            content.background(Circle().fill(tint ?? Color.gray))
        }
    }
}
