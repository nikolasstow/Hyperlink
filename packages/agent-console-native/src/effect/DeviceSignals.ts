/**
 * What the device tells us about getting through to a server: the network
 * coming and going, and the app returning to the foreground (iOS suspends it
 * in the background, so anything waiting resumes then). The device's own
 * layer is in deviceSignalsNative.ts (React Native); `layerNone` is for away
 * from a device (tests, scripts).
 *
 * @internal
 */
import { Context, Layer, Stream } from "effect";

export type DeviceSignal = "online" | "offline" | "foreground";

export class DeviceSignals extends Context.Service<DeviceSignals, { readonly signals: Stream.Stream<DeviceSignal> }>()("@doubleagent/DeviceSignals") {
  /** No signals. */
  static readonly layerNone = Layer.succeed(DeviceSignals)({ signals: Stream.never });
}
