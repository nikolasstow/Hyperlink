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
      // Each fires on a change of state only: iOS reports the network's
      // details often while it stays up, and the app goes inactive and back
      // (Control Centre, a system sheet) without leaving the foreground; each
      // of those made everything listening start over.
      let away = AppState.currentState === "background";
      const app = AppState.addEventListener("change", (state) => {
        if (state === "background") away = true;
        else if (state === "active" && away) {
          away = false;
          Queue.offerUnsafe(queue, "foreground");
        }
      });
      let connected: boolean | undefined;
      const net = network?.addListener("onNetworkStateChanged", (state) => {
        const now = state.isConnected !== false;
        if (now === connected) return;
        connected = now;
        Queue.offerUnsafe(queue, now ? "online" : "offline");
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
