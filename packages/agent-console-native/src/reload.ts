/**
 * Reload, in every page's 3-dot menu: reloads the JS bundle (development
 * builds only), as the Expo dev menu's Reload does, so its button can stay
 * hidden. The app reopens on the same pages (navigation/KeptNav.ts).
 *
 * @internal
 */
import type { NativeStackHeaderItemMenuAction } from "@react-navigation/native-stack";
import { DevSettings } from "react-native";

/** Reload is in the menus (development builds only). */
export const canReload = __DEV__;

export const reloadApp = (): void => DevSettings.reload();

/** Reload as a native header menu's item: none in a release build. */
export const reloadMenuItems: ReadonlyArray<NativeStackHeaderItemMenuAction> = canReload
  ? [
      {
        type: "action",
        label: "Reload",
        icon: { type: "sfSymbol", name: "arrow.clockwise" },
        onPress: reloadApp,
      },
    ]
  : [];
