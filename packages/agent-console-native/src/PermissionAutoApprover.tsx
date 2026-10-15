/**
 * Keeps the server's sessions watched while the app is in the foreground, so
 * permission asks in sessions set to allow all (`full`, the default;
 * sessionPermissions.ts) are answered app-wide (sessions/SessionWatch.ts),
 * whether or not their chat is open. A new session asks within a moment of
 * being made, before its chat has loaded; an ask missed stalls the run.
 *
 * Sessions set to ask are left alone: their chat shows the prompt.
 *
 * @internal
 */
import * as React from "react";
import { AppState } from "react-native";
import { useAppContext } from "./AppContext";
import { serverAddressOf } from "./opencode/serverAddress";
import { useSessionWatch } from "./sessions/useSessionWatch";

/** Mounted once, inside the app's context. */
export const PermissionAutoApprover = (): null => {
  const { address } = useAppContext();
  const [foreground, setForeground] = React.useState(AppState.currentState !== "background");

  React.useEffect(() => {
    // Only "background" is a real background; "inactive" flaps constantly.
    const subscription = AppState.addEventListener("change", (state) => setForeground(state !== "background"));
    return () => subscription.remove();
  }, []);

  useSessionWatch(serverAddressOf(address), foreground);
  return null;
};
