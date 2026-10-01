/**
 * `DeviceSignals` from the device: the network coming and going (expo-network)
 * and the app returning to the foreground (AppState).
 *
 * The network side is expo-network's native module, loaded optionally: a
 * build from before it has no network events, and only loses that signal.
 *
 * @internal
 */
import { requireOptionalNativeModule } from "expo";
import type { NetworkState } from "expo-network";
import { Effect, Layer, Queue, Stream } from "effect";
import { AppState } from "react-native";
import { type DeviceSignal, DeviceSignals } from "./DeviceSignals";


/** The one thing used of expo-network's native module. */
interface ExpoNetwork {
  readonly addListener: (event: "onNetworkStateChanged", listener: (state: NetworkState) => void) => { readonly remove: () => void };
}

const network = requireOptionalNativeModule<ExpoNetwork>("ExpoNetwork");

/** Every signal, as it happens. */
const signals: Stream.Stream<DeviceSignal> = Stream.callback<DeviceSignal>((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const app = AppState.addEventListener("change", (state) => {
        if (state === "active") Queue.offerUnsafe(queue, "foreground");
      });
      const net = network?.addListener("onNetworkStateChanged", (state) => {
        Queue.offerUnsafe(queue, state.isConnected === false ? "offline" : "online");
      });
      return { app, net };
    }),
    ({ app, net }) =>
      Effect.sync(() => {
        app.remove();
        net?.remove();
      }),
  ),
);

/** The device's own signals. */
export const layer = Layer.succeed(DeviceSignals)({ signals });
