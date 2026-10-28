/**
 * The pages the printer page opens: Files, Health, and Settings. Each is a
 * real page on the stack: the back button returns to the printer page. They
 * use the printer page's live link (printerPageLink.ts), so they open no
 * connection of their own.
 *
 * See docs/handoffs/plugin-devices-files-editors.md (decision 24).
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootStackParamList } from "../RootNavigator";
import { useTextColors, withAlpha } from "../theme";
import { Backdrop } from "./Backdrop";
import { PrinterFiles } from "./PrinterFiles";
import { fmtBytes, healthItems } from "./printerFormat";
import { useMeasure, usePrinterPageLink } from "./printerPageLink";
import { isPrinting } from "./sdcp";
import { Card, Dot, Row, usePalette } from "./ui";
import type { PrinterLink } from "./usePrinterLink";

type PageProps<Name extends "ServerPrinterFiles" | "ServerPrinterHealth" | "ServerPrinterSettings"> = NativeStackScreenProps<RootStackParamList, Name>;

/** A printer page's frame: the backdrop and a scroll view under the header, or a note when the printer page is gone. */
const Page = (props: { readonly link: PrinterLink | undefined; readonly children: (link: PrinterLink) => React.ReactNode }): React.ReactElement => {
  const text = useTextColors();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const link = props.link;
  return (
    <View style={styles.root}>
      <Backdrop uri={undefined} glow={0} />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: headerHeight + 10, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.narrow}>{link === undefined ? <Text style={[styles.foot, { color: text.tertiaryLabel }]}>Open the printer page first.</Text> : props.children(link)}</View>
      </ScrollView>
    </View>
  );
};

export const PrinterFilesScreen = (props: PageProps<"ServerPrinterFiles">): React.ReactElement => {
  const link = usePrinterPageLink(props.route.params.serverAddress);
  return (
    <Page link={link}>
      {(printer) => (
        <PrinterFiles
          relayBase={printer.relayBase}
          reachable={printer.relayReachable}
          printingName={isPrinting(printer.status) ? printer.status?.PrintInfo?.Filename : undefined}
        />
      )}
    </Page>
  );
};

export const PrinterHealthScreen = (props: PageProps<"ServerPrinterHealth">): React.ReactElement => {
  const link = usePrinterPageLink(props.route.params.serverAddress);
  const text = useTextColors();
  const palette = usePalette();
  return (
    <Page link={link}>
      {(printer) => {
        const { status, attributes } = printer;
        const film = status?.ReleaseFilm;
        const filmMax = attributes?.ReleaseFilmMax;
        const filmRatio = film !== undefined && filmMax !== undefined && filmMax > 0 ? film / filmMax : undefined;
        const health = healthItems(attributes?.DevicesStatus);
        const healthBad = health.filter((item) => !item.ok).length;
        return (
          <>
            <Card title="Printer" right={attributes?.FirmwareVersion !== undefined ? <Text style={[styles.faint, { color: text.tertiaryLabel }]}>Firmware {attributes.FirmwareVersion}</Text> : undefined}>
              {film !== undefined && filmMax !== undefined && filmRatio !== undefined ? (
                <View style={styles.meter}>
                  <View style={styles.meterTop}>
                    <Text style={[styles.meterLabel, { color: text.secondaryLabel }]}>Release film</Text>
                    <Text style={[styles.meterValue, { color: text.label }]}>
                      {film.toLocaleString()} / {filmMax.toLocaleString()}
                    </Text>
                  </View>
                  <View style={styles.meterTrack}>
                    <View style={[styles.meterFill, { width: `${Math.min(100, filmRatio * 100)}%`, backgroundColor: filmRatio >= 1 ? palette.bad : filmRatio >= 0.85 ? palette.warn : palette.ok }]} />
                  </View>
                  {filmRatio >= 0.85 ? (
                    <Text style={[styles.meterNote, { color: filmRatio >= 1 ? palette.bad : text.tertiaryLabel }]}>
                      {filmRatio >= 1 ? "Past its rated number of cycles. Replace the film soon." : "Nearing its rated number of cycles."}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <Row label="UV LED" value={status?.TempOfUVLED !== undefined ? `${status.TempOfUVLED.toFixed(1)} °C` : "—"} />
              <Row label="Resin" value={status?.TempOfTank !== undefined ? `${status.TempOfTank} °C${status.TempTargetTank ? ` · target ${status.TempTargetTank} °C` : ""}` : "—"} />
              <Row label="Storage free" value={attributes?.RemainingMemory !== undefined ? fmtBytes(attributes.RemainingMemory) : "—"} />
              <Row label="Network" value={`${attributes?.NetworkStatus === "eth" ? "Ethernet" : attributes?.NetworkStatus === "wlan" ? "Wi-Fi" : "—"}${attributes?.UsbDiskStatus === 1 ? " · USB drive in" : ""}`} />
              <Row label="Address" value={printer.printerIp ?? "—"} last />
            </Card>
            {health.length > 0 ? (
              <Card title="Self-check" right={<Text style={[styles.faint, { color: healthBad > 0 ? palette.bad : text.tertiaryLabel }]}>{healthBad === 0 ? "All normal" : `${healthBad} to check`}</Text>}>
                <View style={styles.health}>
                  {health.map((item) => (
                    <View key={item.label} style={[styles.healthItem, item.ok ? null : { backgroundColor: withAlpha(palette.bad, 0.14) }]}>
                      <Dot tone={item.ok ? "ok" : "bad"} size={7} />
                      <Text style={[styles.healthText, { color: text.label }]} numberOfLines={1}>
                        {item.label}
                      </Text>
                    </View>
                  ))}
                </View>
              </Card>
            ) : null}
          </>
        );
      }}
    </Page>
  );
};

export const PrinterSettingsScreen = (props: PageProps<"ServerPrinterSettings">): React.ReactElement => {
  const link = usePrinterPageLink(props.route.params.serverAddress);
  const text = useTextColors();
  const palette = usePalette();
  const [measure, setMeasure] = useMeasure();
  return (
    <Page link={link}>
      {(printer) => {
        const online = printer.link.kind === "Open";
        const connection = online
          ? printer.link.kind === "Open" && printer.link.via === "Direct"
            ? `Direct to the printer at ${printer.printerIp ?? "its address"}`
            : `Through the relay on ${props.route.params.serverName}`
          : "Not connected";
        return (
          <>
            <Card title="Stage">
              <View style={styles.switchRow}>
                <View style={styles.switchText}>
                  <Text style={[styles.switchLabel, { color: text.label }]}>Measurements</Text>
                  <Text style={[styles.switchNote, { color: text.tertiaryLabel }]}>A 10 mm grid, a ruler, and the layer number on the LCD.</Text>
                </View>
                <Switch value={measure} onValueChange={setMeasure} trackColor={{ true: palette.accent, false: "rgba(127,127,127,0.3)" }} />
              </View>
            </Card>
            <Card title="Connection">
              <Row label="Status" value={connection} />
              <Row label="Printer" value={printer.printerIp ?? "—"} />
              <Row label="Relay" value={printer.relayReachable ? printer.relayBase.replace(/^https?:\/\//, "") : "Not reachable"} />
              <Row label="Camera" value={printer.secureUrl !== undefined ? "H.264, 30 fps" : "MJPEG, 10 fps"} last />
            </Card>
          </>
        );
      }}
    </Page>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  narrow: { width: "100%", maxWidth: 700, alignSelf: "center" },
  foot: { fontSize: 13, textAlign: "center", marginTop: 40 },
  faint: { fontSize: 12 },
  meter: { paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(127,127,127,0.3)" },
  meterTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  meterLabel: { fontSize: 15 },
  meterValue: { fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  meterTrack: { height: 5, borderRadius: 3, backgroundColor: "rgba(127,127,127,0.2)", overflow: "hidden" },
  meterFill: { height: 5, borderRadius: 3 },
  meterNote: { fontSize: 12, marginTop: 7 },
  health: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  healthItem: { width: "48.5%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, paddingVertical: 10, borderRadius: 12, backgroundColor: "rgba(127,127,127,0.1)" },
  healthText: { fontSize: 13, flexShrink: 1 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  switchText: { flex: 1 },
  switchLabel: { fontSize: 15 },
  switchNote: { fontSize: 12, marginTop: 2 },
});
