/**
 * DIAG(app-perf): temporary. Logs (to Metro) JS-thread stalls and UI-thread
 * dropped frames with the screen showing, to find what makes the app slow.
 * Remove once found.
 *
 * @internal
 */
import * as React from "react";
import { runOnJS, useFrameCallback } from "react-native-reanimated";

let screen = "?";
export const setPerfScreen = (name: string): void => {
  screen = name;
  console.log("[perf] screen", name);
};

const JS_TICK_MS = 100;
const JS_STALL_MS = 200;
const UI_SLOW_FRAME_MS = 40;

const logFrames = (count: number, worst: number): void => console.log("[perf] ui slow frames", JSON.stringify({ screen, count, worstMs: Math.round(worst) }));

export const PerfMonitor = (): null => {
  // JS thread: a timer that should tick every 100ms; a late tick is a stall.
  React.useEffect(() => {
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const late = now - last - JS_TICK_MS;
      if (late > JS_STALL_MS) console.log("[perf] js stall", JSON.stringify({ screen, ms: late }));
      last = now;
    }, JS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // UI thread: frames slower than 40ms, batched per second.
  useFrameCallback((info) => {
    "worklet";
    const gap = info.timeSincePreviousFrame ?? 0;
    if (gap > UI_SLOW_FRAME_MS) runOnJS(logFrames)(1, gap);
  });
  return null;
};
