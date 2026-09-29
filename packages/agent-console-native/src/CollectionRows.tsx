/**
 * The pieces a collection page is drawn with: rows for the list (the tree
 * view, rows that expand in place) and tiles for the grid.
 *
 * Rows and tiles are SwiftUI so each carries the native context menu (a hard
 * press lifts it, with what it offers below, each with its icon), the same
 * structure the extension tree view and SessionCard run.
 *
 * @internal
 */
import * as React from "react";
import { Button, ContextMenu, Host, HStack, Image, ProgressView, RNHostView, Spacer, Text as UIText, VStack } from "@expo/ui/swift-ui";
import { background, cornerRadius, font, foregroundStyle, frame, lineLimit, onTapGesture, padding } from "@expo/ui/swift-ui/modifiers";
import { DynamicColorIOS, Pressable, StyleSheet, Text, View } from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";
import { colors } from "./colors";
import { RunCountdownRing } from "./RunCountdownRing";

export const INDENT = 20;
const CHEVRON_COL = 20;
const ICON_COL = 30;
const DIVIDER = DynamicColorIOS({ light: "rgba(60,60,67,0.4)", dark: "rgba(120,120,128,0.5)" });

/** Something a row's context menu offers. */
export interface MenuAction {
  readonly label: string;
  readonly icon: SFSymbol;
  readonly destructive?: boolean;
  readonly onPress: () => void;
}

const withMenu = (menu: ReadonlyArray<MenuAction>, trigger: React.ReactElement): React.ReactElement =>
  menu.length === 0 ? (
    trigger
  ) : (
    <ContextMenu>
      <ContextMenu.Items>
        {menu.map((action) => (
          <Button key={action.label} label={action.label} systemImage={action.icon} role={action.destructive === true ? "destructive" : undefined} onPress={action.onPress} />
        ))}
      </ContextMenu.Items>
      <ContextMenu.Trigger>{trigger}</ContextMenu.Trigger>
    </ContextMenu>
  );

const Separator = (props: { readonly inset: number }): React.ReactElement => <View style={[styles.separator, { marginLeft: props.inset }]} />;

/** Size of the countdown ring where the play button was. */
const RING = 26;

/** The countdown ring in a SwiftUI row, where its play button was: an RN
 * view hosted in place, as the file icons in the tree view are. */
const CountdownSlot = (props: { readonly durationMs: number; readonly onCancel: () => void }): React.ReactElement => (
  <RNHostView matchContents>
    <Pressable onPress={props.onCancel} hitSlop={10} accessibilityRole="button" accessibilityLabel="Stop">
      <RunCountdownRing size={RING} durationMs={props.durationMs} />
    </Pressable>
  </RNHostView>
);

/**
 * An item (a script, a package): its title, its real name beneath (and a
 * detail, when it has one), and the play button when it runs. Tapping the row
 * runs or opens it; while selecting, tapping selects it instead.
 */
export const ItemRow = (props: {
  readonly title: string;
  readonly name: string;
  readonly detail?: string;
  /** None for an item that is just its name (a package). */
  readonly icon: SFSymbol | undefined;
  readonly depth: number;
  readonly width: number;
  readonly busy: boolean;
  readonly canRun: boolean;
  /** Counting down to a run: the ring shows, and a tap stops it. */
  readonly countdownMs?: number;
  readonly onCancel?: () => void;
  readonly selecting: boolean;
  readonly selected: boolean;
  readonly pinned: boolean;
  readonly onRun: () => void;
  readonly onSelect: () => void;
  readonly menu: ReadonlyArray<MenuAction>;
}): React.ReactElement => {
  const counting = props.countdownMs !== undefined;
  const cancel = props.onCancel ?? props.onRun;
  const trigger = (
    <HStack
      spacing={10}
      alignment="center"
      modifiers={[
        padding({ leading: 12 + props.depth * INDENT, trailing: 16, top: 10, bottom: 10 }),
        frame({ width: props.width, alignment: "leading" }),
        background(colors.systemBackground),
        onTapGesture(props.selecting ? props.onSelect : counting ? cancel : props.onRun),
      ]}
    >
      {props.selecting ? (
        <Image systemName={props.selected ? "checkmark.circle.fill" : "circle"} size={20} color={props.selected ? colors.tint : colors.secondaryLabel} modifiers={[frame({ width: CHEVRON_COL })]} />
      ) : (
        <UIText modifiers={[frame({ width: CHEVRON_COL })]}>{""}</UIText>
      )}
      <VStack alignment="leading" spacing={2}>
        {/* The icon sits on the title's line, not centered on the block. */}
        <HStack spacing={8} alignment="center">
          {props.icon === undefined ? null : <Image systemName={props.icon} size={15} color={colors.secondaryLabel} />}
          <UIText modifiers={[font({ size: 15 }), foregroundStyle(colors.label), lineLimit(1)]}>{props.title}</UIText>
        </HStack>
        <UIText modifiers={[font({ size: 12, family: "Menlo" }), foregroundStyle(colors.secondaryLabel), lineLimit(1)]}>{props.name}</UIText>
        {props.detail === undefined ? null : (
          <UIText modifiers={[font({ size: 12 }), foregroundStyle(colors.secondaryLabel), lineLimit(1)]}>{props.detail}</UIText>
        )}
      </VStack>
      <Spacer />
      {props.pinned ? <Image systemName="pin.fill" size={11} color={colors.secondaryLabel} /> : null}
      {props.selecting || !props.canRun ? null : props.countdownMs !== undefined ? (
        <CountdownSlot durationMs={props.countdownMs} onCancel={cancel} />
      ) : props.busy ? (
        <ProgressView />
      ) : (
        <Button systemImage="play.fill" onPress={props.onRun} />
      )}
    </HStack>
  );
  return (
    <View>
      <Host matchContents={{ vertical: true, horizontal: false }} style={{ width: props.width }}>
        {withMenu(props.selecting ? [] : props.menu, trigger)}
      </Host>
      <Separator inset={12 + props.depth * INDENT + CHEVRON_COL + 10} />
    </View>
  );
};

/**
 * A filter, category or package: a row that expands in place to show its
 * scripts (the chevron), or opens its own page (the rest of the row).
 */
export const NodeRow = (props: {
  readonly title: string;
  readonly subtitle?: string;
  readonly icon: SFSymbol;
  readonly count: number;
  readonly depth: number;
  readonly width: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onOpen: () => void;
  readonly menu: ReadonlyArray<MenuAction>;
}): React.ReactElement => {
  const trigger = (
    <HStack
      spacing={10}
      alignment="center"
      modifiers={[
        padding({ leading: 12 + props.depth * INDENT, trailing: 16, top: 11, bottom: 11 }),
        frame({ width: props.width, alignment: "leading" }),
        background(colors.systemBackground),
        onTapGesture(props.onOpen),
      ]}
    >
      <Button systemImage={props.expanded ? "chevron.down" : "chevron.right"} onPress={props.onToggle} modifiers={[frame({ width: CHEVRON_COL })]} />
      <Image systemName={props.icon} size={17} color={colors.tint} modifiers={[frame({ width: ICON_COL })]} />
      <VStack alignment="leading" spacing={2}>
        <UIText modifiers={[font({ size: 15, weight: "medium" }), foregroundStyle(colors.label), lineLimit(1)]}>{props.title}</UIText>
        {props.subtitle === undefined ? null : (
          <UIText modifiers={[font({ size: 12 }), foregroundStyle(colors.secondaryLabel), lineLimit(1)]}>{props.subtitle}</UIText>
        )}
      </VStack>
      <Spacer />
      <UIText modifiers={[font({ size: 14 }), foregroundStyle(colors.secondaryLabel)]}>{String(props.count)}</UIText>
      <Image systemName="chevron.forward" size={12} color={colors.secondaryLabel} />
    </HStack>
  );
  return (
    <View>
      <Host matchContents={{ vertical: true, horizontal: false }} style={{ width: props.width }}>
        {withMenu(props.menu, trigger)}
      </Host>
      <Separator inset={12 + props.depth * INDENT + CHEVRON_COL + ICON_COL + 20} />
    </View>
  );
};

/** A grid tile: a script (with its play button) or a filter, category or
 * package (with its count). Tapping a script runs it; tapping the others
 * opens them. */
export const Tile = (props: {
  readonly title: string;
  readonly subtitle: string;
  /** None for an item that is just its name (a package). */
  readonly icon: SFSymbol | undefined;
  readonly width: number;
  readonly count?: number;
  readonly busy?: boolean;
  /** Counting down to a run: the ring shows, and a tap stops it. */
  readonly countdownMs?: number;
  readonly onCancel?: () => void;
  readonly selecting?: boolean;
  readonly selected?: boolean;
  readonly onPress: () => void;
  readonly onRun?: () => void;
  readonly menu: ReadonlyArray<MenuAction>;
}): React.ReactElement => {
  const trigger = (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[
        padding({ all: 12 }),
        frame({ width: props.width, height: 80, alignment: "topLeading" }),
        background(colors.cardBackground),
        cornerRadius(14),
        onTapGesture(props.countdownMs !== undefined && props.onCancel !== undefined ? props.onCancel : props.onPress),
      ]}
    >
      {/* The icon sits on the title's line. */}
      <HStack spacing={8} alignment="center">
        {props.selecting === true ? (
          <Image systemName={props.selected === true ? "checkmark.circle.fill" : "circle"} size={16} color={props.selected === true ? colors.tint : colors.secondaryLabel} />
        ) : props.icon === undefined ? null : (
          <Image systemName={props.icon} size={16} color={colors.tint} />
        )}
        <UIText modifiers={[font({ size: 15, weight: "medium" }), foregroundStyle(colors.label), lineLimit(2)]}>{props.title}</UIText>
        <Spacer />
        {props.count === undefined ? null : <UIText modifiers={[font({ size: 13 }), foregroundStyle(colors.secondaryLabel)]}>{String(props.count)}</UIText>}
        {props.onRun === undefined || props.selecting === true ? null : props.countdownMs !== undefined ? (
          <CountdownSlot durationMs={props.countdownMs} onCancel={props.onCancel ?? props.onPress} />
        ) : props.busy === true ? (
          <ProgressView />
        ) : (
          <Button systemImage="play.fill" onPress={props.onRun} />
        )}
      </HStack>
      <Spacer />
      <UIText modifiers={[font({ size: 12, family: props.onRun === undefined ? undefined : "Menlo" }), foregroundStyle(colors.secondaryLabel), lineLimit(1)]}>{props.subtitle}</UIText>
    </VStack>
  );
  return (
    <Host matchContents style={{ width: props.width }}>
      {withMenu(props.selecting === true ? [] : props.menu, trigger)}
    </Host>
  );
};

export const SectionHeader = (props: { readonly title: string }): React.ReactElement => <Text style={styles.sectionHeader}>{props.title}</Text>;

export const SeeAllRow = (props: { readonly label: string; readonly onPress: () => void }): React.ReactElement => (
  <Pressable style={styles.seeAll} onPress={props.onPress}>
    <Text style={styles.seeAllLabel}>{props.label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: DIVIDER,
  },
  sectionHeader: {
    color: colors.secondaryLabel,
    fontSize: 13,
    textTransform: "uppercase",
    marginTop: 22,
    marginBottom: 6,
    marginHorizontal: 16,
  },
  seeAll: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  seeAllLabel: {
    color: colors.tint,
    fontSize: 15,
  },
});
