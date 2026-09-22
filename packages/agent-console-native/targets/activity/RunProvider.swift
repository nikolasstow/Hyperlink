import WidgetKit

/**
 The timeline behind both run widgets.

 One entry per refresh, not a schedule of future entries: a widget cannot
 predict what an agent will be doing in twenty minutes, and a timeline of
 guesses would render confidently wrong state. So each refresh produces exactly
 one entry — now — and asks to be called again later.

 `reloadPolicy` is a request, not a guarantee. WidgetKit grants roughly 40–70
 refreshes a day and spends them at its own discretion, which is why the
 interval below is a floor rather than a promise, and why the push-triggered
 `WidgetCenter.shared.reloadAllTimelines()` (see `SessionWidgets.swift`) is what
 will actually make these feel live.
 */
struct RunEntry: TimelineEntry {
  let date: Date
  let snapshot: RunSnapshot
}

struct RunProvider: TimelineProvider {
  /// Asked for more often while something is running, since that is when the
  /// state is worth having. Both are far enough apart to survive the budget.
  private static let busyInterval: TimeInterval = 5 * 60
  private static let idleInterval: TimeInterval = 30 * 60

  /// Rendered in the widget gallery and as a redacted skeleton before the first
  /// fetch — so it holds shaped sample data, never an empty frame.
  func placeholder(in context: Context) -> RunEntry {
    RunEntry(date: Date(), snapshot: .preview)
  }

  /// The gallery preview also runs here. It must return promptly and must not
  /// depend on the network, so a preview context short-circuits to the sample.
  func getSnapshot(in context: Context, completion: @escaping (RunEntry) -> Void) {
    if context.isPreview {
      completion(RunEntry(date: Date(), snapshot: .preview))
      return
    }
    Task {
      let snapshot = await WidgetData.snapshot()
      completion(RunEntry(date: Date(), snapshot: snapshot))
    }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<RunEntry>) -> Void) {
    Task {
      let snapshot = await WidgetData.snapshot()
      let interval = snapshot.busyCount > 0 ? Self.busyInterval : Self.idleInterval
      let entry = RunEntry(date: Date(), snapshot: snapshot)
      completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(interval))))
    }
  }
}
