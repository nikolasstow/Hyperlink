/**
 * A virtualized inset grouped list, as in iOS Settings: section headers
 * above groups of rows, each group with rounded ends. Only the rows on
 * screen mount, so a long list opens at once.
 *
 * Every row and header has a fixed height, so the list knows each item's
 * place without measuring (`getItemLayout`). The list is the page's first
 * view, so the large title collapses into the bar as it scrolls.
 *
 * @internal
 */
import * as React from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { colors } from "../colors";
import { CARD_RADIUS } from "../CardGlass";
import { SectionHeader } from "./ui";

/** A section header's height, with the gap above it. */
const HEADER_HEIGHT = 50;

export interface Group<T> {
  readonly key: string;
  readonly title: string;
  readonly right?: React.ReactNode;
  readonly rows: ReadonlyArray<T>;
}

type Item<T> = { readonly kind: "Header"; readonly key: string; readonly title: string; readonly right?: React.ReactNode } | { readonly kind: "Row"; readonly key: string; readonly row: T; readonly first: boolean; readonly last: boolean };

export const GroupedList = <T,>(props: {
  readonly groups: ReadonlyArray<Group<T>>;
  /** A stable function (defined once, outside the page), so the items are not built again on each render. */
  readonly rowKey: (row: T) => string;
  readonly rowHeight: number;
  readonly renderRow: (row: T, last: boolean) => React.ReactElement;
  /** Above the list: a loading note or an error. Its height is fixed. */
  readonly top?: React.ReactNode;
  readonly topHeight: number;
  readonly width: number;
  readonly bottomInset: number;
}): React.ReactElement => {
  const { groups, rowKey } = props;
  const items = React.useMemo(
    (): ReadonlyArray<Item<T>> =>
      groups.flatMap((group): ReadonlyArray<Item<T>> => [
        { kind: "Header", key: `header-${group.key}`, title: group.title, right: group.right },
        ...group.rows.map((row, index): Item<T> => ({ kind: "Row", key: rowKey(row), row, first: index === 0, last: index === group.rows.length - 1 })),
      ]),
    [groups, rowKey],
  );
  const offsets = React.useMemo(() => {
    let at = props.topHeight;
    return items.map((item) => {
      const start = at;
      at += item.kind === "Header" ? HEADER_HEIGHT : props.rowHeight;
      return start;
    });
  }, [items, props.rowHeight, props.topHeight]);
  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.key}
      getItemLayout={(_, index) => ({ length: items[index]?.kind === "Header" ? HEADER_HEIGHT : props.rowHeight, offset: offsets[index] ?? 0, index })}
      initialNumToRender={14}
      maxToRenderPerBatch={12}
      windowSize={7}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ width: props.width, alignSelf: "center", paddingBottom: props.bottomInset + 40 }}
      ListHeaderComponent={<View style={{ height: props.topHeight }}>{props.top}</View>}
      renderItem={({ item }) =>
        item.kind === "Header" ? (
          <View style={styles.header}>
            <SectionHeader title={item.title} right={item.right} />
          </View>
        ) : (
          <View style={[styles.row, { height: props.rowHeight }, item.first ? styles.first : null, item.last ? styles.last : null]}>{props.renderRow(item.row, item.last)}</View>
        )
      }
    />
  );
};

const styles = StyleSheet.create({
  header: { height: HEADER_HEIGHT, justifyContent: "flex-end" },
  row: { backgroundColor: colors.cardBackground, overflow: "hidden" },
  first: { borderTopLeftRadius: CARD_RADIUS, borderTopRightRadius: CARD_RADIUS },
  last: { borderBottomLeftRadius: CARD_RADIUS, borderBottomRightRadius: CARD_RADIUS },
});
