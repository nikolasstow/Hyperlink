/**
 * The app-wide toast: a glass pill at the bottom, above the bottom bar, saying
 * what just happened with a way to take it back ("Archived · Undo"). It
 * outlives the view that raised it (an archived row is gone by the time it
 * shows), so it is mounted once at the root, and anything can raise it with
 * `showToast`. A new toast replaces the one showing; each goes on its own.
 *
 * On glass by the app's rules (PinToast, Dubz.tsx): it rises by `bottom`, a
 * layout change, never a transform or opacity on the glass or its parents; the
 * GlassView rounds itself, with nothing clipping it.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "./colors";

/** How long a toast stays before it goes. */
const SHOW_MS = 4000;
const HEIGHT = 48;
const WIDTH_MAX = 340;
/** Room left for the bottom bar (the composer or search pill) under it. */
const ABOVE_BAR = 76;

export interface Toast {
  readonly message: string;
  /** What its button does ("Undo"), if it has one. */
  readonly action?: {
    readonly label: string;
    readonly run: () => void;
  };
}

interface Shown extends Toast {
  readonly id: number;
}

let current: Shown | undefined;
let nextId = 0;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((listener) => listener());

/** Show a toast, replacing any showing. */
export const showToast = (toast: Toast): void => {
  nextId += 1;
  current = {
    ...toast,
    id: nextId,
  };
  emit();
};

const clear = (id: number): void => {
  if (current?.id !== id) return;
  current = undefined;
  emit();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Mounted once, at the app's root. */
export const AppToastHost = (): React.ReactElement | null => {
  const toast = React.useSyncExternalStore(subscribe, () => current);
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(screenWidth - 32, WIDTH_MAX);
  const resting = insets.bottom + ABOVE_BAR;
  const offscreen = -(HEIGHT + 40);
  const rise = useSharedValue(offscreen);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toastId = toast?.id;
  React.useEffect(() => {
    if (toastId === undefined) return;
    rise.value = offscreen;
    rise.value = withSpring(resting, { damping: 20, stiffness: 220, mass: 0.9 });
    timer.current = setTimeout(() => {
      rise.value = withTiming(offscreen, { duration: 240, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished === true) runOnJS(clear)(toastId);
      });
    }, SHOW_MS);
    return () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    };
  }, [toastId, rise, offscreen, resting]);

  const frame = useAnimatedStyle(() => ({ bottom: rise.value }));

  if (toast === undefined) return null;
  const { action } = toast;
  return (
    <Animated.View pointerEvents="box-none" style={[styles.toast, { width, left: (screenWidth - width) / 2 }, frame]}>
      <GlassView style={[StyleSheet.absoluteFill, styles.glass]} glassEffectStyle={{ style: "regular", animate: true }} />
      <View style={styles.row}>
        <Text style={styles.message} numberOfLines={1}>
          {toast.message}
        </Text>
        {action === undefined ? null : (
          <Pressable
            hitSlop={10}
            onPress={() => {
              action.run();
              if (timer.current !== undefined) clearTimeout(timer.current);
              rise.value = withTiming(offscreen, { duration: 200 }, (finished) => {
                if (finished === true) runOnJS(clear)(toast.id);
              });
            }}
          >
            <Text style={styles.action}>{action.label}</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    height: HEIGHT,
  },
  glass: {
    borderRadius: HEIGHT / 2,
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
  },
  message: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
    fontWeight: "500",
  },
  action: {
    color: colors.tint,
    fontSize: 16,
    fontWeight: "600",
  },
});
