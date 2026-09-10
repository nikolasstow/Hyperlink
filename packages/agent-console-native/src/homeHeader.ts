/**
 * Home's native nav header, shared so the LAUNCH screen and the real Home use
 * the exact same header — same buttons, same glass, same positions. The header
 * items are native navigation items (the nav bar owns their glass/grouping), so
 * they can only exist on a nav screen; sharing this config is how the launch
 * skeleton and Home line up instead of drifting.
 *
 * Handlers are injected: Home wires them to real navigation; the launch passes
 * no-ops (the buttons are just chrome while loading).
 *
 * @internal
 */
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";

export type HomeHeaderHandlers = {
  readonly onSettings: () => void;
  readonly onSearch: () => void;
  readonly onNewRepo: () => void;
};

export const homeHeaderOptions = (handlers: HomeHeaderHandlers): NativeStackNavigationOptions => ({
  headerShown: true,
  headerTransparent: true,
  headerStyle: { backgroundColor: "transparent" },
  headerTitle: "",
  headerBackVisible: false,
  headerShadowVisible: false,
  // Real native header items — the nav bar owns their glass, grouping and
  // spacing (rendering our own glassEffect nested a second capsule).
  unstable_headerLeftItems: () => [
    {
      type: "button",
      label: "Settings",
      icon: { type: "sfSymbol", name: "gearshape" },
      onPress: handlers.onSettings,
    },
  ],
  unstable_headerRightItems: () => [
    {
      type: "button",
      label: "Search",
      icon: { type: "sfSymbol", name: "magnifyingglass" },
      onPress: handlers.onSearch,
    },
    // A spacing item breaks the shared capsule so each button gets its own
    // circle, matching the single left-hand button.
    { type: "spacing", spacing: 24 },
    {
      type: "button",
      label: "New repo or empty project",
      icon: { type: "sfSymbol", name: "folder.badge.plus" },
      onPress: handlers.onNewRepo,
    },
  ],
  scrollEdgeEffects: { top: "soft", bottom: "soft" },
});
