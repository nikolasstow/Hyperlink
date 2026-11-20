/**
 * DIAG(app-perf): temporary. Logs (to Metro) JS-thread stalls and UI-thread
 * dropped frames with the screen showing, to find what makes the app slow.
 * Remove once found.
 *
 * @internal
 */
import * as React from "react";
import { AppState } from "react-native";
import { runOnJS, useFrameCallback } from "react-native-reanimated";

let screen = "?";
export const setPerfScreen = (name: string): void => {
  screen = name;
  console.log("[perf] screen", name);
};

/** When the owner last tapped something that opens a page (`markTap`). */
let tapAt: { readonly label: string; readonly at: number } | undefined;

/** Marks a tap that opens a page, for `useOpenTiming`. */
export const markTap = (label: string): void => {
  tapAt = { label, at: Date.now() };
};

/**
 * Logs the time from the last `markTap` to this page's first frame: the
 * effect runs after the first commit, and the frame after it is on screen.
 */
export const useOpenTiming = (page: string): void => {
  React.useEffect(() => {
    const tap = tapAt;
    tapAt = undefined;
    if (tap === undefined) return;
    const id = requestAnimationFrame(() => console.log("[perf] open", JSON.stringify({ page, from: tap.label, ms: Date.now() - tap.at })));
    return () => cancelAnimationFrame(id);
  }, [page]);
};

const JS_TICK_MS = 100;
const JS_STALL_MS = 200;
const UI_SLOW_FRAME_MS = 40;

const logFrames = (count: number, worst: number): void => console.log("[perf] ui slow frames", JSON.stringify({ screen, count, worstMs: Math.round(worst) }));

export const PerfMonitor = (): null => {
  // JS thread: a timer that should tick every 100ms; a late tick is a stall.
  // A gap while the app was not active is the app paused, not a stall: it is logged apart.
  React.useEffect(() => {
    let last = Date.now();
    let leftActive = AppState.currentState !== "active";
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") leftActive = true;
    });
    const timer = setInterval(() => {
      const now = Date.now();
      const late = now - last - JS_TICK_MS;
      if (late > JS_STALL_MS) console.log(leftActive ? "[perf] paused (app not active)" : "[perf] js stall", JSON.stringify({ screen, ms: late }));
      leftActive = AppState.currentState !== "active";
      last = now;
    }, JS_TICK_MS);
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  // UI thread: frames slower than 40ms, batched per second.
  useFrameCallback((info) => {
    "worklet";
    const gap = info.timeSincePreviousFrame ?? 0;
    if (gap > UI_SLOW_FRAME_MS) runOnJS(logFrames)(1, gap);
  });
  return null;
};
