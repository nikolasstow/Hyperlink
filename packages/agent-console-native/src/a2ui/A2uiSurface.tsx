/**
 * A2UI pilot renderer: draws an {@link A2uiSurfaceData} with DA's OWN glass
 * components — the same `CardGlass` + row look the plugin PageBlock system
 * uses (`PluginPageScreen`). This is the point of the pilot: prove A2UI's open,
 * declarative surface maps cleanly onto the native glass design system, with no
 * agent emitting it yet (a hand-written demo surface drives it).
 *
 * Two-way inputs (TextField, ChoicePicker) write the local data model by JSON
 * Pointer; a Button fires an {@link A2uiAction} with the current data as its
 * context — the "user acts, agent would re-emit" loop, stubbed to `onAction`.
 *
 * @internal
 */
import * as React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CardGlass, CARD_RADIUS } from "../CardGlass";
import { colors } from "../colors";
import { SystemIcon } from "../SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "../theme";
import { getPointer, resolveString, setPointer } from "./pointer";
import type { A2uiAction, A2uiComponent, A2uiSurfaceData } from "./types";

export const A2uiSurface = (props: {
  readonly surface: A2uiSurfaceData;
  readonly onAction?: (action: A2uiAction, data: Readonly<Record<string, unknown>>) => void;
}): React.ReactElement | null => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const [data, setData] = React.useState<Record<string, unknown>>({ ...props.surface.dataModel });

  const components = props.surface.components;

  const fireAction = (action: A2uiAction): void => props.onAction?.({ ...action, context: { ...action.context, ...data } }, data);

  // Resolve a component by id and draw it with the glass primitives. Containers
  // recurse over their children (the A2UI adjacency model).
  const render = (id: string): React.ReactElement | null => {
    const node: A2uiComponent | undefined = components[id];
    if (node === undefined) return null;
    switch (node.component) {
      case "Text": {
        const style = node.role === "title" ? styles.title : node.role === "label" ? styles.label : node.role === "caption" ? styles.caption : styles.value;
        return (
          <Text key={id} style={style}>
            {resolveString(node.text, data)}
          </Text>
        );
      }
      case "Column":
        return (
          <View key={id} style={styles.column}>
            {node.children.map(render)}
          </View>
        );
      case "Row":
        return (
          <View key={id} style={styles.row}>
            {node.children.map(render)}
          </View>
        );
      case "Card":
        return (
          <View key={id} style={styles.card}>
            <CardGlass />
            {node.title === undefined ? null : <Text style={styles.cardTitle}>{resolveString(node.title, data)}</Text>}
            <View style={styles.cardBody}>{node.children.map(render)}</View>
          </View>
        );
      case "List":
        return (
          <View key={id} style={styles.card}>
            <CardGlass />
            {node.children.map((childId, index) => (
              <View key={childId} style={[styles.listRow, index > 0 && styles.rowBorder]}>
                {render(childId)}
              </View>
            ))}
          </View>
        );
      case "Divider":
        return <View key={id} style={styles.divider} />;
      case "Button":
        return (
          <Pressable key={id} style={styles.button} onPress={() => fireAction(node.action)} accessibilityRole="button">
            <Text style={[styles.buttonLabel, node.destructive === true && styles.destructive]}>{resolveString(node.label, data)}</Text>
          </Pressable>
        );
      case "TextField": {
        const current = getPointer(data, node.path);
        return (
          <View key={id} style={styles.field}>
            {node.label === undefined ? null : <Text style={styles.label}>{node.label}</Text>}
            <TextInput
              style={styles.input}
              value={current === undefined || current === null ? "" : String(current)}
              placeholder={node.placeholder}
              placeholderTextColor={textColors.secondaryLabel}
              onChangeText={(next) => setData((prev) => setPointer(prev, node.path, next))}
            />
          </View>
        );
      }
      case "ChoicePicker": {
        const current = getPointer(data, node.path);
        return (
          <View key={id} style={styles.field}>
            {node.label === undefined ? null : <Text style={styles.label}>{node.label}</Text>}
            <View style={styles.choices}>
              {node.options.map((option) => {
                const selected = current === option.value;
                return (
                  <Pressable key={option.value} style={[styles.choice, selected && styles.choiceOn]} onPress={() => setData((prev) => setPointer(prev, node.path, option.value))}>
                    {selected ? <SystemIcon name="checkmark" size={12} color={colors.tint} /> : null}
                    <Text style={[styles.choiceLabel, selected && styles.choiceLabelOn]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      }
    }
  };

  return render(props.surface.root);
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    column: { gap: 12 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
    card: { borderRadius: CARD_RADIUS, overflow: "hidden", paddingVertical: 4 },
    cardTitle: { color: text.label, fontSize: 18, fontWeight: "600", paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
    cardBody: { paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
    listRow: { paddingHorizontal: 14, paddingVertical: 12 },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
    title: { color: text.label, fontSize: 22, fontWeight: "700" },
    label: { color: text.label, fontSize: 16 },
    value: { color: text.secondaryLabel, fontSize: 16 },
    caption: { color: text.secondaryLabel, fontSize: 13 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginVertical: 4 },
    button: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.accentTint, alignItems: "center" },
    buttonLabel: { color: colors.tint, fontSize: 16, fontWeight: "600" },
    destructive: { color: colors.destructive },
    field: { gap: 8 },
    input: { color: text.label, fontSize: 16, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.accentTint },
    choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    choice: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.cardBackground },
    choiceOn: { backgroundColor: colors.accentTint },
    choiceLabel: { color: text.label, fontSize: 15 },
    choiceLabelOn: { color: colors.tint, fontWeight: "600" },
  });
