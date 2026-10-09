/**
 * A server's page: the services/plugins bound to this server, each a menu item
 * that opens its full page. A plugin with a widget will render that widget here
 * instead (Phase 3); for now every entry is a plain row. Server-scoped and
 * keyed by the server (serverId) so it stays multi-server-ready — each entry
 * opens its page against *this* server's address, never a hardcoded one.
 *
 * Phase 1 entries are the built-in plugins, static. The plugin registry feeds
 * them later. See docs/handoffs/server-pages-and-widgets.md.
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SFSymbol } from "sf-symbols-typescript";
import { CARD_RADIUS, CardGlass } from "./CardGlass";
import { colors } from "./colors";
import type { RootStackParamList } from "./RootNavigator";
import { type Server, serverById } from "./servers";
import { SystemIcon } from "./SystemIcon";
import { type TextColors, useScreenBackground, useTextColors, useThemedStyles } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "Server">;

interface Entry {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: SFSymbol;
  readonly open: (navigation: Props["navigation"], server: Server) => void;
}

const ENTRIES: ReadonlyArray<Entry> = [
  {
    id: "ups",
    title: "UPS",
    subtitle: "Power & battery",
    icon: "bolt.fill",
    open: (navigation, server) => navigation.navigate("ServerUps", { serverName: server.name, serverAddress: server.address }),
  },
];

/** The little always-on server on each box (~/ups-monitor/server.js) exposes
 * /api/host with the machine's specs. Moves to the proper server agent later. */
const HOST_PORT = 5196;

interface HostInfo {
  readonly name: string;
  readonly hostname: string;
  readonly model: string | null;
  readonly chip: string | null;
  readonly arch: string;
  readonly cores: number;
  readonly osName: string;
  readonly osVersion: string | null;
  readonly osBuild: string | null;
  readonly memoryBytes: number;
  readonly uptimeS: number;
}

const useHost = (address: string): { readonly host: HostInfo | undefined; readonly offline: boolean } => {
  const [host, setHost] = React.useState<HostInfo | undefined>(undefined);
  const [offline, setOffline] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    void fetch(`http://${address}:${HOST_PORT}/api/host`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data: HostInfo) => {
        if (!alive) return;
        setHost(data);
        setOffline(false);
      })
      .catch(() => {
        if (alive) setOffline(true);
      });
    return () => {
      alive = false;
    };
  }, [address]);
  return { host, offline };
};

const fmtMemory = (bytes: number): string => `${Math.round(bytes / 1024 ** 3)} GB`;

const fmtUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

/** The About rows, in order. Address is always known; the rest come from the
 * host endpoint once it answers. */
const specRows = (address: string, host: HostInfo | undefined): ReadonlyArray<readonly [string, string]> => {
  const rows: Array<readonly [string, string]> = [["Address", address]];
  if (host === undefined) return rows;
  if (host.model !== null) rows.push(["Model", host.model]);
  if (host.chip !== null) rows.push(["Chip", host.chip]);
  rows.push(["Memory", fmtMemory(host.memoryBytes)]);
  rows.push(["Cores", String(host.cores)]);
  if (host.osVersion !== null) rows.push([host.osName, host.osBuild === null ? host.osVersion : `${host.osVersion} (${host.osBuild})`]);
  rows.push(["Host Name", host.hostname]);
  rows.push(["Uptime", fmtUptime(host.uptimeS)]);
  return rows;
};

export const ServerScreen = (props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const background = useScreenBackground("grouped");
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const server = serverById(props.route.params.serverId);
  const { host, offline } = useHost(server?.address ?? "");

  if (server === undefined) {
    return (
      <View style={[styles.center, { backgroundColor: background }]}>
        <Text style={styles.missing}>Server not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: background }}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: headerHeight + 8, paddingBottom: insets.bottom + 32 }}
    >
      <Text style={styles.sectionLabel}>About</Text>
      <View style={styles.card}>
        <CardGlass />
        {specRows(server.address, host).map(([label, value], index) => (
          <View key={label} style={[styles.specRow, index > 0 && styles.rowBorder]}>
            <Text style={styles.specLabel}>{label}</Text>
            <Text style={styles.specValue} numberOfLines={1}>
              {value}
            </Text>
          </View>
        ))}
      </View>
      {offline ? <Text style={styles.offlineNote}>Couldn’t reach the server for specs.</Text> : null}

      <Text style={styles.sectionLabel}>Services</Text>
      <View style={styles.card}>
        <CardGlass />
        {ENTRIES.map((entry, index) => (
          <TouchableOpacity
            key={entry.id}
            style={[styles.row, index > 0 && styles.rowBorder]}
            activeOpacity={0.6}
            onPress={() => entry.open(props.navigation, server)}
          >
            <View style={styles.icon}>
              <SystemIcon name={entry.icon} size={20} color={colors.tint} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{entry.title}</Text>
              <Text style={styles.rowMeta}>{entry.subtitle}</Text>
            </View>
            <SystemIcon name="chevron.right" size={15} color={textColors.secondaryLabel} />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    missing: {
      color: text.secondaryLabel,
      fontSize: 15,
    },
    specRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 14,
      paddingVertical: 11,
      minHeight: 44,
      gap: 12,
    },
    specLabel: {
      color: text.label,
      fontSize: 16,
    },
    specValue: {
      color: text.secondaryLabel,
      fontSize: 16,
      flexShrink: 1,
      textAlign: "right",
    },
    offlineNote: {
      color: text.secondaryLabel,
      fontSize: 13,
      marginTop: 6,
      marginLeft: 4,
    },
    sectionLabel: {
      color: text.secondaryLabel,
      fontSize: 13,
      textTransform: "uppercase",
      marginTop: 22,
      marginBottom: 6,
      marginLeft: 4,
    },
    card: {
      borderRadius: CARD_RADIUS,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 11,
      minHeight: 56,
      gap: 12,
    },
    rowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    icon: {
      width: 28,
      alignItems: "center",
    },
    rowText: {
      flex: 1,
    },
    rowTitle: {
      color: text.label,
      fontSize: 16,
    },
    rowMeta: {
      color: text.secondaryLabel,
      fontSize: 13,
      marginTop: 2,
    },
  });
