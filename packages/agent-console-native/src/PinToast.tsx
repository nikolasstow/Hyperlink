/**
 * The toast a pin raises: "Pin to Workspace Package ⌄", on glass, at the
 * bottom. It says where the new pin shows (the scope last chosen), goes away
 * on its own, and tapping it opens the choice: the workspace package's page,
 * the repo's, or both (docs/handoffs/double-agent-repo-screen-and-plugin-system.md
 * §23.3). Choosing changes this pin and is remembered for the next.
 *
 * It slides rather than fades: animating a GlassView's opacity stops it
 * rendering glass (TitlePill).
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "./colors";
import type { PinScope } from "./pagesClient";
import { SystemIcon } from "./SystemIcon";

/** How long the collapsed toast stays before it goes. */
const SHOW_MS = 4000;
/** How long it stays after a choice, to show what was chosen. */
const AFTER_CHOICE_MS = 900;
/** Far enough below its place to be off screen. */
const HIDDEN_OFFSET = 220;

/** What the scopes are called ("Workspace Package", "Repo"). */
export interface PinScopeLabels {
  readonly group: string;
  readonly top: string;
}

export const scopeLabel = (scope: PinScope, labels: PinScopeLabels): string =>
  scope === "group" ? labels.group : scope === "top" ? labels.top : `${labels.group} and ${labels.top}`;

const choices: ReadonlyArray<PinScope> = ["group", "top", "both"];

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
  const offset = React.useRef(new Animated.Value(HIDDEN_OFFSET)).current;
  const [expanded, setExpanded] = React.useState(false);
  const [scope, setScope] = React.useState<PinScope | undefined>(subject?.scope);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The parent's callbacks change with every render of it; the toast keeps
  // the latest in a ref, so a parent render never restarts it (that reset it
  // collapsed and on its way out, so it vanished instead of expanding).
  const onDone = React.useRef(props.onDone);
  onDone.current = props.onDone;

  /** Slide out in `ms`, then say it is done. Reads only refs and the offset,
   * so it is the same whichever render made it. */
  const hideIn = React.useCallback(
    (ms: number) => {
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(offset, { toValue: HIDDEN_OFFSET, duration: 220, useNativeDriver: true }).start(() => onDone.current());
      }, ms);
    },
    [offset],
  );

  const stopTimer = (): void => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };

  // Each new pin (and only a new pin): in from below, collapsed, on its way
  // out unless tapped.
  const subjectId = subject?.id;
  React.useEffect(() => {
    if (subjectId === undefined) return;
    setExpanded(false);
    offset.setValue(HIDDEN_OFFSET);
    Animated.spring(offset, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 180 }).start();
    hideIn(SHOW_MS);
    return () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    };
  }, [subjectId, offset, hideIn]);

  // The scope shown follows the pin it is about.
  const subjectScope = subject?.scope;
  React.useEffect(() => {
    if (subjectScope !== undefined) setScope(subjectScope);
  }, [subjectId, subjectScope]);

  if (subject === undefined || scope === undefined) return null;

  const expand = (): void => {
    // Open stays open until a choice is made.
    stopTimer();
    setExpanded(true);
  };

  const choose = (next: PinScope): void => {
    setScope(next);
    props.onChoose(next);
    setExpanded(false);
    hideIn(AFTER_CHOICE_MS);
  };

  return (
    <Animated.View pointerEvents="box-none" style={[styles.anchor, { bottom: props.bottom, transform: [{ translateY: offset }] }]}>
      <View style={styles.toast}>
        <GlassView style={StyleSheet.absoluteFill} glassEffectStyle={{ style: "regular", animate: true }} />
        {expanded ? (
          <View style={styles.choices}>
            <Text style={styles.heading}>Pin To</Text>
            {choices.map((choice) => (
              <Pressable key={choice} style={styles.choice} onPress={() => choose(choice)}>
                <Text style={styles.choiceLabel}>{choiceLabel(choice, subject.labels)}</Text>
                {choice === scope ? <SystemIcon name="checkmark" size={15} color={colors.tint} /> : null}
              </Pressable>
            ))}
          </View>
        ) : (
          <Pressable style={styles.collapsed} onPress={expand}>
            <SystemIcon name="pin.fill" size={14} color={colors.label} />
            <Text style={styles.text} numberOfLines={1}>
              Pin to {scopeLabel(scope, subject.labels)}
            </Text>
            <SystemIcon name="chevron.down" size={12} color={colors.secondaryLabel} />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
  },
  toast: {
    borderRadius: 22,
    overflow: "hidden",
    minWidth: 220,
    maxWidth: "100%",
  },
  collapsed: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  text: {
    flexShrink: 1,
    color: colors.label,
    fontSize: 15,
    fontWeight: "500",
  },
  choices: {
    paddingVertical: 8,
    minWidth: 260,
  },
  heading: {
    color: colors.secondaryLabel,
    fontSize: 13,
    textTransform: "uppercase",
    paddingHorizontal: 18,
    paddingVertical: 6,
  },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  choiceLabel: {
    color: colors.label,
    fontSize: 16,
  },
});
