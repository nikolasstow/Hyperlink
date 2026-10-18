/**
 * Building blocks for the printer page: its colours, glass cards, status
 * dots, chips, and buttons.
 *
 * The page sits on a blurred wash of the current print's slicer render, so
 * the cards are glass: they show the print behind them. The UV violet is the
 * printer's own 405 nm light; it marks what is lit or running.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ColorValue, type StyleProp, type ViewStyle } from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";
import { CARD_RADIUS, CardGlass } from "../CardGlass";
import { colors } from "../colors";
import { SystemIcon } from "../SystemIcon";
import { useTextColors } from "../theme";

export const UV = "#8f73ff";
export const UV_INK = "#b8a6ff";
export const UV_SOFT = "rgba(143,115,255,0.18)";
export const GREEN = "#32d07c";
export const RED = "#ff5a5f";
export const AMBER = "#ffb547";
/** The LCD is always dark, whatever the app's theme: it is the printer's screen. */
export const LCD = "#050508";

export type Tone = "uv" | "ok" | "warn" | "bad" | "plain";

const TONE_COLOR: Record<Exclude<Tone, "plain">, string> = { uv: UV_INK, ok: GREEN, warn: AMBER, bad: RED };

/** A tone's colour; `plain` is the theme's colour, which can be a `PlatformColor`, so never turn it into a string. */
export const toneColor = (tone: Tone, plain: ColorValue): ColorValue => (tone === "plain" ? plain : TONE_COLOR[tone]);

/** A glass card with an optional title row. */
export const Card = (props: { readonly title?: string; readonly right?: React.ReactNode; readonly children: React.ReactNode; readonly style?: StyleProp<ViewStyle>; readonly flush?: boolean }): React.ReactElement => {
  const text = useTextColors();
  return (
    <View style={[styles.card, props.style]}>
      <CardGlass />
      {props.title !== undefined ? (
        <View style={styles.head}>
          <Text style={[styles.title, { color: text.label }]}>{props.title}</Text>
          <View style={styles.spacer} />
          {props.right}
        </View>
      ) : null}
      <View style={props.flush === true ? undefined : styles.body}>{props.children}</View>
    </View>
  );
};

export const Dot = (props: { readonly tone: Tone; readonly size?: number }): React.ReactElement => {
  const size = props.size ?? 8;
  const color = toneColor(props.tone, "rgba(142,147,163,0.8)");
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, shadowColor: color, shadowOpacity: props.tone === "plain" ? 0 : 0.8, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } }} />;
};

/** A small capsule: a dot and a label, coloured by tone. */
export const Chip = (props: { readonly tone: Tone; readonly label: string; readonly dot?: boolean; readonly onPress?: () => void }): React.ReactElement => {
  const text = useTextColors();
  const color = toneColor(props.tone, text.secondaryLabel);
  const body = (
    <View style={[styles.chip, { backgroundColor: props.tone === "plain" ? "rgba(127,127,127,0.14)" : `${TONE_COLOR[props.tone]}26` }]}>
      {props.dot !== false ? <Dot tone={props.tone} size={7} /> : null}
      <Text style={[styles.chipText, { color }]}>{props.label}</Text>
    </View>
  );
  return props.onPress === undefined ? body : <Pressable onPress={props.onPress}>{body}</Pressable>;
};

/** A filled (primary), glass (default), or red-text (destructive) button. */
export const Button = (props: {
  readonly label: string;
  readonly icon?: SFSymbol;
  readonly kind?: "primary" | "default" | "destructive";
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly style?: StyleProp<ViewStyle>;
}): React.ReactElement => {
  const text = useTextColors();
  const kind = props.kind ?? "default";
  const color: ColorValue = kind === "primary" ? "#ffffff" : kind === "destructive" ? RED : text.label;
  return (
    <Pressable
      disabled={props.disabled === true || props.busy === true}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        kind === "primary" ? styles.primary : kind === "destructive" ? styles.destructive : styles.plainButton,
        (props.disabled === true || props.busy === true) && styles.disabled,
        pressed && styles.pressed,
        props.style,
      ]}
    >
      {props.busy === true ? <ActivityIndicator color={color} /> : props.icon !== undefined ? <SystemIcon name={props.icon} size={15} color={color} weight="semibold" /> : null}
      <Text style={[styles.buttonText, { color }]}>{props.label}</Text>
    </Pressable>
  );
};

/** A label and value row with a hairline under it. */
export const Row = (props: { readonly label: string; readonly value: string; readonly tone?: Tone; readonly last?: boolean }): React.ReactElement => {
  const text = useTextColors();
  return (
    <View style={[styles.row, props.last === true ? null : styles.rowLine]}>
      <Text style={[styles.rowLabel, { color: text.secondaryLabel }]}>{props.label}</Text>
      <Text style={[styles.rowValue, { color: props.tone === undefined ? text.label : toneColor(props.tone, text.label) }]} numberOfLines={1}>
        {props.value}
      </Text>
    </View>
  );
};

/** A two-column grid of small labelled values. */
export const Cells = (props: { readonly cells: ReadonlyArray<{ readonly label: string; readonly value: string; readonly wide?: boolean }> }): React.ReactElement => {
  const text = useTextColors();
  return (
    <View style={styles.cells}>
      {props.cells.map((cell) => (
        <View key={cell.label} style={[styles.cell, cell.wide === true ? styles.cellWide : null]}>
          <Text style={[styles.cellLabel, { color: text.tertiaryLabel }]}>{cell.label.toUpperCase()}</Text>
          <Text style={[styles.cellValue, { color: text.label }]}>{cell.value}</Text>
        </View>
      ))}
    </View>
  );
};

export const styles = StyleSheet.create({
  card: { borderRadius: CARD_RADIUS, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, marginBottom: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 14, minHeight: 40 },
  title: { fontSize: 16, fontWeight: "600", letterSpacing: -0.2 },
  spacer: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 26, borderRadius: 13 },
  chipText: { fontSize: 13, fontWeight: "600" },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, height: 46, paddingHorizontal: 16, borderRadius: 14 },
  primary: { backgroundColor: UV, shadowColor: UV, shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  plainButton: { backgroundColor: "rgba(127,127,127,0.16)" },
  destructive: { backgroundColor: "rgba(255,90,95,0.14)" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
  buttonText: { fontSize: 16, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 11 },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  rowLabel: { fontSize: 15 },
  rowValue: { fontSize: 15, fontWeight: "600", flexShrink: 1, textAlign: "right", fontVariant: ["tabular-nums"] },
  cells: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: { width: "48.5%", flexGrow: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: "rgba(127,127,127,0.1)" },
  cellWide: { width: "100%" },
  cellLabel: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5 },
  cellValue: { fontSize: 15, fontWeight: "600", marginTop: 2, fontVariant: ["tabular-nums"] },
});
