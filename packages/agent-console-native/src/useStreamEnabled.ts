/**
 * Whether a session stream should be connected right now.
 *
 * True while the chat screen is the focused route AND the app is in the
 * foreground. Navigating back or backgrounding the app drops the SSE
 * connection; returning re-establishes it, and `useSessionStream` reloads
 * history on reconnect, so nothing missed while disconnected is lost.
 *
 * A long-lived SSE connection from a backgrounded phone is not free: iOS
 * suspends the socket without closing it cleanly, so the server keeps a dead
 * subscriber and the client sits on a connection that will never deliver.
 * Reconnecting on return is both cheaper and more correct than pretending the
 * connection survived.
 *
 * Two things make the raw "focused && foreground" signal too twitchy to gate a
 * connection on directly, and a flap tears the stream down and back up — each
 * reconnect reloading history and, mid-run, briefly ending the Live Activity:
 *
 * - iOS `AppState` flaps through `"inactive"` constantly (app-switcher peek,
 *   Control Center, a system prompt, a Dynamic Island / ActivityKit
 *   interaction). `"inactive"` is still foreground; only `"background"` is a
 *   real background, so that's the only state that counts as not-foreground.
 * - Even so, focus/background can blip for a frame. So the *disable* is
 *   debounced: enabling is immediate, but a drop only takes effect after the
 *   signal has stayed false for `DISABLE_GRACE_MS`. A quick flap back to true
 *   cancels it, and the connection is never touched.
 *
 * @internal
 */
import { useIsFocused } from "@react-navigation/native";
import * as React from "react";
import { AppState, type AppStateStatus } from "react-native";

/** Only a true background is "not foreground" — `"inactive"` is transient. */
const isForeground = (state: AppStateStatus): boolean => state !== "background";

/** How long the gate must stay false before the stream is actually dropped.
 * Absorbs transient flaps; a real navigate-away/background lasts far longer. */
const DISABLE_GRACE_MS = 2000;

export const useStreamEnabled = (): boolean => {
  const isFocused = useIsFocused();
  const [foreground, setForeground] = React.useState(() => isForeground(AppState.currentState));

  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      setForeground(isForeground(next));
    });
    return () => subscription.remove();
  }, []);

  const target = isFocused && foreground;

  // Debounced view of `target`: on immediately, off only after it has been off
  // for the grace window, so a momentary flap never restarts the stream.
  const [enabled, setEnabled] = React.useState(target);
  React.useEffect(() => {
    if (target) {
      setEnabled(true);
      return;
    }
    const timer = setTimeout(() => setEnabled(false), DISABLE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [target]);

  return enabled;
};
