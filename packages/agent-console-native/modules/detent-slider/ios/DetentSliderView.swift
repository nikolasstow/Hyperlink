import ExpoModulesCore
import SwiftUI
import UIKit

/// What the slider shows: its stops (on a track of their own values, so they
/// sit at their amount) and the stop it is on.
final class DetentSliderModel: ObservableObject {
  @Published var stops: [Double] = [0, 1]
  @Published var value: Double = 0
  var onChange: ((Double) -> Void)?
  private let haptics = UISelectionFeedbackGenerator()

  /// Snap a point on the track to the nearest stop; landing on a new one is a
  /// detent: the selection haptic, and the change reported.
  func slide(to raw: Double) {
    let snapped = stops.min(by: { abs($0 - raw) < abs($1 - raw) }) ?? raw
    guard snapped != value else { return }
    value = snapped
    haptics.selectionChanged()
    haptics.prepare()
    onChange?(snapped)
  }
}

struct DetentSliderContent: View {
  @ObservedObject var model: DetentSliderModel

  var body: some View {
    let lower = model.stops.first ?? 0
    let upper = Swift.max(model.stops.last ?? 1, lower + 1)
    Slider(
      value: Binding(get: { model.value }, set: { model.slide(to: $0) }),
      in: lower...upper
    )
  }
}

/// A native SwiftUI slider whose thumb only rests on the given stops.
public final class DetentSliderView: ExpoView {
  let model: DetentSliderModel
  let onValueChange = EventDispatcher()
  private let host: UIHostingController<DetentSliderContent>

  public required init(appContext: AppContext? = nil) {
    let model = DetentSliderModel()
    self.model = model
    host = UIHostingController(rootView: DetentSliderContent(model: model))
    super.init(appContext: appContext)
    host.view.backgroundColor = .clear
    addSubview(host.view)
    model.onChange = { [weak self] value in
      self?.onValueChange(["value": value])
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    host.view.frame = bounds
  }
}
