/**
 * The stage's two pages: the layer on the LCD, and the camera. A swipe moves
 * between them and wraps around (past the camera comes the layer again). The
 * page the owner left it on is kept on the phone, and the stage opens there
 * next time.
 *
 * The wrap is a strip of four pages, `[camera, layer, camera, layer]`, shown
 * from the middle two. When a swipe lands on an end, the strip jumps to the
 * same page in the middle, with no animation. Only the middle camera page is
 * live; the end one is a still placeholder for the moment of the swipe.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";
import { type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTheme, withAlpha } from "../theme";

export type StagePage = "Layer" | "Camera";

const PAGE_KEY = "agent-console-native:printer:stage-page";

/** The page the owner left the stage on. */
const useStoredPage = (): readonly [StagePage | undefined, (page: StagePage) => void] => {
  const [page, setPage] = React.useState<StagePage | undefined>(undefined);
  const [read, setRead] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(PAGE_KEY)
      .then((raw) => {
        if (alive) setPage(raw === "Camera" ? "Camera" : "Layer");
      })
      .catch((cause: unknown) => {
        console.error("[printer] reading the stage page failed", cause);
        if (alive) setPage("Layer");
      })
      .finally(() => {
        if (alive) setRead(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  const change = React.useCallback((next: StagePage) => {
    setPage(next);
    AsyncStorage.setItem(PAGE_KEY, next).catch((cause: unknown) => console.error("[printer] keeping the stage page failed", cause));
  }, []);
  return [read ? page : undefined, change];
};

/** The strip's page for a stage page, in the middle of the strip. */
const middleIndex = (page: StagePage): number => (page === "Layer" ? 1 : 2);

export const StagePager = (props: {
  readonly width: number;
  readonly height: number;
  readonly layer: React.ReactNode;
  /** The camera page; `visible` is true while it shows. */
  readonly camera: (visible: boolean) => React.ReactNode;
}): React.ReactElement => {
  const { colors } = useTheme();
  const [stored, setStored] = useStoredPage();
  const strip = React.useRef<ScrollView>(null);
  const page = stored ?? "Layer";

  const goTo = (next: StagePage, animated: boolean): void => {
    strip.current?.scrollTo({ x: middleIndex(next) * props.width, animated });
    if (!animated) setStored(next);
  };

  const landed = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const index = Math.round(event.nativeEvent.contentOffset.x / props.width);
    // The ends are copies: jump to the same page in the middle.
    const next: StagePage = index === 0 || index === 2 ? "Camera" : "Layer";
    if (index === 0 || index === 3) strip.current?.scrollTo({ x: middleIndex(next) * props.width, animated: false });
    if (next !== page) setStored(next);
  };

  // The width changes when the screen turns: stay on the same page.
  React.useEffect(() => {
    strip.current?.scrollTo({ x: middleIndex(page) * props.width, animated: false });
  }, [props.width, page]);

  if (stored === undefined) return <View style={{ width: props.width, height: props.height }} />;
  const placeholder = <View style={[styles.still, { width: props.width, height: props.height }]} />;
  return (
    <View>
      <ScrollView
        ref={strip}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: middleIndex(page) * props.width, y: 0 }}
        onMomentumScrollEnd={landed}
        style={{ width: props.width, height: props.height }}
      >
        <View style={{ width: props.width }}>{placeholder}</View>
        <View style={{ width: props.width }}>{props.layer}</View>
        <View style={{ width: props.width }}>{props.camera(page === "Camera")}</View>
        <View style={{ width: props.width }}>{props.layer}</View>
      </ScrollView>
      <View style={styles.dots} accessibilityRole="tablist">
        {(["Layer", "Camera"] as const).map((each) => (
          <Pressable key={each} hitSlop={8} onPress={() => goTo(each, false)} accessibilityRole="tab" accessibilityLabel={each} accessibilityState={{ selected: page === each }}>
            <View style={[styles.dot, { backgroundColor: page === each ? colors.primary : withAlpha(colors.primary, 0.3) }]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  still: { borderRadius: 16, backgroundColor: "#000000" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 10 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
});
