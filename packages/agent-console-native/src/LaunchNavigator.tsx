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
 * @internal
 */
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as React from "react";
import { colors } from "./colors";
import { homeHeaderOptions } from "./homeHeader";
import { LaunchScreen } from "./LaunchScreen";

const Stack = createNativeStackNavigator();
const noop = (): void => {};

export const LaunchNavigator = (): React.ReactElement => (
  <NavigationContainer>
    <Stack.Navigator screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen
        name="Launch"
        component={LaunchScreen}
        options={homeHeaderOptions({ onSettings: noop, onSearch: noop, onNewRepo: noop })}
      />
    </Stack.Navigator>
  </NavigationContainer>
);
