/**
 * The navigator shown while the app boots. It exists so the launch screen gets
 * the REAL native nav header (via the shared `homeHeaderOptions`) — the same
 * Settings/Search/New buttons Home has, in the same place — rather than a
 * hand-built approximation that drifts.
 *
 * Its buttons are no-ops (there's nowhere to go yet). It carries no client and
 * no data, so it can't hit the blank the full early Home-mount caused. Replaced
 * by the real RootNavigator once the app is ready.
 *
 * The app reopens on the pages last open (navigation/KeptNav.ts): Home's
 * skeleton only when that is Home, the plain background otherwise (not Home
 * flashing before another page).
 *
 * @internal
 */
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as React from "react";
import { View } from "react-native";
import { topPage } from "./navigation/keptPages";
import { useKeptNav } from "./navigation/useKeptNav";
import { useScreenBackground } from "./theme";
import { homeHeaderOptions } from "./homeHeader";
import { LaunchScreen } from "./LaunchScreen";

const Stack = createNativeStackNavigator();
const noop = (): void => {};

export const LaunchNavigator = (): React.ReactElement => {
  // The theme's background (Appearance → Background), as the app's screens.
  const background = useScreenBackground();
  const kept = useKeptNav();
  const top = kept === undefined ? undefined : topPage(kept);
  if (top !== undefined && top.name !== "Home") return <View style={{ flex: 1, backgroundColor: background }} />;
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ animation: "none", contentStyle: { backgroundColor: background } }}>
        <Stack.Screen
          name="Launch"
          component={LaunchScreen}
          options={homeHeaderOptions({ onSettings: noop, onSearch: noop, onArchived: noop })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
