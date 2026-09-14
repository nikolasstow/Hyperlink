/**
 * PROTOTYPE: a long-press context menu for a session, copying Messages — the
 * wrapped card lifts into a preview with the menu below it (native
 * `UIContextMenuInteraction`, via react-native-ios-context-menu). No preview
 * config, so the card itself is the lifted preview.
 *
 * Reusable: wrap any session card (Home, repo lists) and pass an `onAction`. The
 * menu is defined once here, with a real section (Stop, inline/destructive)
 * separated from the primary actions.
 *
 * PROTOTYPE DEVIATIONS (to resolve before this is non-prototype):
 * - It's a NATIVE component. On a binary without the module,
 *   `<ContextMenuView>` renders "Unimplemented component: RNIContextMenuView".
 *   So it's gated on the native module being present (via the
 *   react-native-ios-utilities TurboModule) and falls back to just the card —
 *   the tap still works; the menu appears after the next native rebuild.
 * - The library ships source-only, so its types are stubbed locally in
 *   `react-native-ios-context-menu.d.ts` rather than resolved from the package.
 * - Wired onto Home cards only so far, not repo lists.
 * - Default lifted preview (the card); no custom/enlarged preview yet.
 *
 * @internal
 */
import * as React from "react";
import { TurboModuleRegistry } from "react-native";
import { ContextMenuView } from "react-native-ios-context-menu";
import type { MenuConfig } from "react-native-ios-context-menu";

/** True only when the native context-menu libs are in the binary. Rendering the
 * native view without them yields "Unimplemented component"; this gates it off
 * until the module ships in a build. */
const NATIVE_MENU_AVAILABLE = TurboModuleRegistry.get("RNIUtilitiesModule") != null;

export type SessionMenuAction = "open" | "rename" | "stop";

const MENU: MenuConfig = {
  menuTitle: "",
  menuItems: [
    { actionKey: "open", actionTitle: "Open", icon: { iconType: "SYSTEM", iconValue: "bubble.left.and.bubble.right" } },
    { actionKey: "rename", actionTitle: "Rename", icon: { iconType: "SYSTEM", iconValue: "pencil" } },
    // A real section: inline group, visually divided, destructive.
    {
      menuTitle: "",
      menuOptions: ["displayInline"],
      menuItems: [
        {
          actionKey: "stop",
          actionTitle: "Stop",
          menuAttributes: ["destructive"],
          icon: { iconType: "SYSTEM", iconValue: "stop.fill" },
        },
      ],
    },
  ],
};

export const SessionContextMenu = (props: {
  readonly onAction: (action: SessionMenuAction) => void;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  // Without the native module, render the card alone — no menu, but no crash.
  if (!NATIVE_MENU_AVAILABLE) return <>{props.children}</>;
  return (
    <ContextMenuView
      menuConfig={MENU}
      onPressMenuItem={({ nativeEvent }) => {
        const key = nativeEvent.actionKey;
        if (key === "open" || key === "rename" || key === "stop") props.onAction(key);
      }}
    >
      {props.children}
    </ContextMenuView>
  );
};
