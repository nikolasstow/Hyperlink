/**
 * Local types for react-native-ios-context-menu.
 *
 * The installed version (3.2.1) ships source only — no built `lib/` — so Metro
 * resolves it via its `react-native`/`source` field at runtime, but `tsc` can't
 * find its declarations. Rather than pull the library's source into our strict
 * compile, declare the subset we use here.
 */
declare module "react-native-ios-context-menu" {
  import type * as React from "react";

  type MenuIcon = { readonly iconType: "SYSTEM"; readonly iconValue: string };

  type MenuActionConfig = {
    readonly actionKey: string;
    readonly actionTitle: string;
    readonly menuAttributes?: ReadonlyArray<"destructive" | "disabled" | "hidden" | "keepsMenuPresented">;
    readonly icon?: MenuIcon;
  };

  export type MenuConfig = {
    readonly menuTitle: string;
    readonly menuOptions?: ReadonlyArray<"destructive" | "displayInline">;
    readonly menuItems?: ReadonlyArray<MenuActionConfig | MenuConfig>;
    readonly icon?: MenuIcon;
  };

  type MenuItemPressEvent = {
    readonly nativeEvent: { readonly actionKey: string; readonly actionTitle: string };
  };

  export const ContextMenuView: React.ComponentType<{
    readonly menuConfig: MenuConfig;
    readonly onPressMenuItem?: (event: MenuItemPressEvent) => void;
    readonly children?: React.ReactNode;
  }>;
}
