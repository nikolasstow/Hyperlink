/**
 * The toast a pin raises, at the bottom, on glass
 * (docs/handoffs/double-agent-repo-screen-and-plugin-system.md §23.3).
 *
 * Collapsed, it is one line: "Pin to Workspace Package ⌄", the scope the new
 * pin went to (the last one chosen). It comes up the moment the pin is made
 * and goes away on its own. Tapping it expands the toast itself, growing
 * upward from its bottom edge into a single-select list (Workspace Package,
 * Repo, Both); choosing moves the pin, is remembered for the next, and the
 * toast settles back and goes.
 *
 * Built by the glass rules the app has learned (AgentButton, TitlePill):
 * - one width always (it never shrinks to its text);
 * - motion is layout, not transform or opacity on the glass or its
 *   ancestors (either composites it into a layer that cannot see the
 *   backdrop): it rises by `bottom` and grows by `height`;
 * - the GlassView carries its own rounding; the content is clipped by a
 *   sibling layer over it, never by a parent around it;
 * - glyphs are font icons in fixed boxes, which centre on the text line
 *   exactly (a native symbol view settles its size late and sits high).
 *
 * @internal
 */
import { Ionicons } from "@expo/vector-icons";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { colors } from "./colors";
import type { PinScope } from "./pagesClient";

/** How long the collapsed toast stays before it goes. */
const SHOW_MS = 4000;
/** After a choice: how long the list shows it, then how long the settled
 * toast stays. */
const CHOSEN_MS = 350;
const SETTLED_MS = 1100;

const WIDTH_MAX = 340;
const RADIUS = 24;
const COLLAPSED = 48;
const ROW = 44;
const HEADING = 30;
const PAD = 6;
const ICON_BOX = 22;

const choices: ReadonlyArray<PinScope> = ["group", "top", "both"];
const EXPANDED = PAD + HEADING + choices.length * ROW + PAD;

const spring = {
  damping: 20,
  stiffness: 220,
  mass: 0.9,
};

/** What the scopes are called ("Workspace Package", "Repo"). */
export interface PinScopeLabels {
  readonly group: string;
  readonly top: string;
}

export const scopeLabel = (scope: PinScope, labels: PinScopeLabels): string =>
  scope === "group" ? labels.group : scope === "top" ? labels.top : `${labels.group} and ${labels.top}`;

const choiceLabel = (scope: PinScope, labels: PinScopeLabels): string => (scope === "both" ? "Both" : scopeLabel(scope, labels));

/** A pin the toast is about. `id` tells one pin's toast from the next. */
export interface PinToastSubject {
  readonly id: string;
  readonly scope: PinScope;
  readonly labels: PinScopeLabels;
}

export const PinToast = (props: {
  readonly subject: PinToastSubject | undefined;
  readonly bottom: number;
  readonly onChoose: (scope: PinScope) => void;
  readonly onDone: () => void;
}): React.ReactElement | null => {
  const { subject } = props;
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(screenWidth - 32, WIDTH_MAX);
  const [scope, setScope] = React.useState<PinScope | undefined>(subject?.scope);
  const [expanded, setExpanded] = React.useState(false);

  // Where it sits (its bottom edge) and how tall it is; 0 → 1 as it opens.
  const offscreen = -(EXPANDED + 40);
  const rise = useSharedValue(offscreen);
  const height = useSharedValue(COLLAPSED);
  const open = useSharedValue(0);

  // The parent's callbacks change with its every render; the latest is kept
  // here, so a parent render never restarts the toast.
  const onDone = React.useRef(props.onDone);
  onDone.current = props.onDone;
  const target = React.useRef(props.bottom);
  target.current = props.bottom;
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimer = (): void => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };

  const finish = React.useCallback(() => onDone.current(), []);

  /** Drop out of sight in `ms`, then say it is done. */
  const leaveIn = React.useCallback(
    (ms: number) => {
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        rise.value = withTiming(offscreen, { duration: 240, easing: Easing.in(Easing.cubic) }, (finished) => {
          if (finished === true) runOnJS(finish)();
        });
      }, ms);
    },
    [rise, offscreen, finish],
  );

  // A new pin, and only a new pin: up from below, collapsed, leaving unless
  // tapped.
  const subjectId = subject?.id;
  const subjectScope = subject?.scope;
  React.useEffect(() => {
    if (subjectId === undefined || subjectScope === undefined) return;
    setScope(subjectScope);
    setExpanded(false);
    height.value = COLLAPSED;
    open.value = 0;
    rise.value = offscreen;
    rise.value = withSpring(target.current, spring);
    leaveIn(SHOW_MS);
    return () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    };
  }, [subjectId, subjectScope, height, open, rise, offscreen, leaveIn]);

  // Keep its place when what is under it changes (the selection bar).
  React.useEffect(() => {
    if (subjectId !== undefined && rise.value > offscreen) rise.value = withSpring(props.bottom, spring);
  }, [props.bottom, subjectId, rise, offscreen]);

  const frame = useAnimatedStyle(() => ({
    bottom: rise.value,
    height: height.value,
  }));
  const collapsedLayer = useAnimatedStyle(() => ({ opacity: 1 - open.value }));
  const listLayer = useAnimatedStyle(() => ({ opacity: open.value }));

  if (subject === undefined || scope === undefined) return null;

  const expand = (): void => {
    // Open stays open until a choice is made.
    clearTimer();
    setExpanded(true);
    height.value = withSpring(EXPANDED, spring);
    open.value = withTiming(1, { duration: 180 });
  };

  const choose = (next: PinScope): void => {
    setScope(next);
    props.onChoose(next);
    clearTimer();
    timer.current = setTimeout(() => {
      setExpanded(false);
      height.value = withSpring(COLLAPSED, spring);
      open.value = withTiming(0, { duration: 160 });
      leaveIn(SETTLED_MS);
    }, CHOSEN_MS);
  };

  return (
    <Animated.View pointerEvents="box-none" style={[styles.toast, { width, left: (screenWidth - width) / 2 }, frame]}>
      <GlassView style={[StyleSheet.absoluteFill, styles.glass]} glassEffectStyle={{ style: "regular", animate: true }} isInteractive />
      {/* The content's clip is a layer over the glass, not a parent of it. */}
      <View style={styles.clip} pointerEvents="box-none">
        <Animated.View style={[styles.list, listLayer]} pointerEvents={expanded ? "auto" : "none"}>
          <Text style={styles.heading}>Pin To</Text>
          {choices.map((choice) => (
            <Pressable key={choice} style={styles.row} onPress={() => choose(choice)}>
              <Text style={styles.label} numberOfLines={1}>
                {choiceLabel(choice, subject.labels)}
              </Text>
              <View style={styles.iconBox}>{choice === scope ? <Ionicons name="checkmark" size={18} color={colors.tint} /> : null}</View>
            </Pressable>
          ))}
        </Animated.View>
        <Animated.View style={[styles.collapsed, collapsedLayer]} pointerEvents={expanded ? "none" : "auto"}>
          <Pressable style={styles.row} onPress={expand}>
            <View style={styles.iconBox}>
              <Ionicons name="pin" size={16} color={colors.label} />
            </View>
            <Text style={styles.label} numberOfLines={1}>
              Pin to {scopeLabel(scope, subject.labels)}
            </Text>
            <View style={styles.iconBox}>
              <Ionicons name="chevron-down" size={15} color={colors.secondaryLabel} />
            </View>
          </Pressable>
        </Animated.View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
  },
  glass: {
    borderRadius: RADIUS,
  },
  clip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: RADIUS,
    overflow: "hidden",
  },
  // Both layers hang from the bottom edge, so the list is revealed upward as
  // the toast grows.
  collapsed: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: COLLAPSED,
    justifyContent: "center",
  },
  list: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: EXPANDED,
    paddingVertical: PAD,
  },
  heading: {
    height: HEADING,
    lineHeight: HEADING,
    paddingHorizontal: 18,
    color: colors.secondaryLabel,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  row: {
    height: ROW,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
  },
  iconBox: {
    width: ICON_BOX,
    height: ICON_BOX,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
    lineHeight: ICON_BOX,
    fontWeight: "500",
  },
});
