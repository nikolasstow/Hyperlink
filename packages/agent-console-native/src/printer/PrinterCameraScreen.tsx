/**
 * The printer's camera on its own page, from the Printer card on the
 * printer home. The feed starts when the page opens and stops when it
 * closes or the app leaves the foreground (PrinterCamera.tsx). It uses the
 * printer home's live link for the relay's address.
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootStackParamList } from "../RootNavigator";
import { useTextColors } from "../theme";
import { Backdrop } from "./Backdrop";
import { CameraPane } from "./PrinterCamera";
import { usePrinterPageLink } from "./printerPageLink";
import { Card } from "./ui";

type Props = NativeStackScreenProps<RootStackParamList, "ServerPrinterCamera">;

/** The camera's frame: 16:9, the printer camera's own shape. */
const ASPECT = 9 / 16;

export const PrinterCameraScreen = (props: Props): React.ReactElement => {
  const text = useTextColors();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const link = usePrinterPageLink(props.route.params.serverAddress);
  const cardWidth = Math.min(width - 32, 900);
  const paneWidth = cardWidth - 32;
  return (
    <View style={styles.root}>
      <Backdrop uri={undefined} glow={0} />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: headerHeight + 10, paddingBottom: insets.bottom + 40, alignItems: "center" }}>
        {link === undefined ? (
          <Text style={[styles.foot, { color: text.tertiaryLabel }]}>Open the printer page first.</Text>
        ) : (
          <Card style={{ width: cardWidth }}>
            <CameraPane relayBase={link.relayBase} secureUrl={link.secureUrl} reachable={link.relayReachable} visible={focused} width={paneWidth} height={Math.round(paneWidth * ASPECT)} />
          </Card>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  foot: { fontSize: 13, textAlign: "center", marginTop: 40 },
});
