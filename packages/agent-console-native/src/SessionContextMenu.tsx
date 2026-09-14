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
 * Native module — needs a rebuild to appear; degrades to just the child on a
 * binary without it (the tap still works).
 *
 * @internal
 */
import * as React from "react";
import { ContextMenuView } from "react-native-ios-context-menu";
import type { MenuConfig } from "react-native-ios-context-menu";

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
}): React.ReactElement => (
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
