/**
 * Dubz home, native — the suggestions surface of the Dubz window, as a SwiftUI
 * view that owns its own scroll, bottom-anchoring, scroll-behind, expand, and
 * row animation. None of that costs a JS render (the reason this moved off
 * `@expo/ui`, which renders real SwiftUI but is driven by React, reconciling the
 * tree across the bridge on every change — the perf ceiling).
 *
 * Home is the one Dubz surface that did not scroll behind the bars (it was a
 * flipped `@expo/ui` List, not a ScrollView like the sub-pages). This view fixes
 * that natively and renders the suggestions. Today the only built suggestion is
 * the session area (`sessions`); Tasks and future applets slot in here later.
 *
 * JS hands it the suggestions to show, the colours, and the bar clearances; it
 * hands back taps (`onOpenSession`, `onViewAll`) and the height it wants while
 * expanded (`onActiveHeight`, so the Dubz window grows to fit).
 *
 * `DubzHomeNativeView` is undefined in a build without the native module (it
 * lands a build ahead of being required) or one too old — JS gates on
 * `apiVersion` and falls back to the `@expo/ui` suggestions until the dev client
 * is rebuilt. `isDubzHomeNative` says which.
 *
 * @internal
 */
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type * as React from "react";
import { type ColorValue, type NativeSyntheticEvent, Platform, type ViewProps } from "react-native";

/** One session row's display data (derived on the JS side from the session
 * list, so the native view never fetches — it only renders what it is given). */
export interface DubzSessionRow {
  readonly id: string;
  readonly title: string;
  /** The last summary line (or relative time) under the title. */
  readonly subtitle?: string;
  /** Epoch ms of the last update, for the number pill / ordering. */
  readonly updated: number;
  /** The worktree the session runs in (needed to send into it). */
  readonly directory: string;
  /** Other sessions in the same file's worktree — the count on the number pill. */
  readonly count?: number;
  readonly unread?: boolean;
  readonly muted?: boolean;
}

export interface DubzHomeNativeProps extends ViewProps {
  /** The session area's rows, most related first (the first is the big pill).
   * Empty hides the session suggestion. Other suggestion kinds (Tasks, applets)
   * are added to this contract as they are built. */
  readonly sessions: ReadonlyArray<DubzSessionRow>;
  /** The content width (the window inside, less margins/left gap). */
  readonly contentWidth: number;
  /** Scroll-behind clearances: content scrolls behind the top bar and the
   * bottom composer pill by these (points). Home's whole point — the surface
   * fills the window and these are the scroll insets, as on the sub-pages. */
  readonly topInset: number;
  readonly bottomInset: number;
  /** Compact mode's left gap (points); rows shrink by it so the top-left
   * button has room. */
  readonly leftInset?: number;
  readonly compact?: boolean;
  /** DEV: draw a border around the real content so the outline matches it. */
  readonly debug?: boolean;
  /** Text colours from the active theme (hex strings at runtime). */
  readonly labelColor?: ColorValue;
  readonly secondaryColor?: ColorValue;
  /** Whether the theme is light: glass takes this appearance, not the phone's. */
  readonly light?: boolean;
  /** Open a session (its row tapped). */
  readonly onOpenSession?: (event: NativeSyntheticEvent<{ readonly id: string }>) => void;
  /** Open the full list ("View All"). */
  readonly onViewAll?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
  /** The height the view wants while expanded (0 when it claims none —
   * collapsed or empty), so the Dubz window grows to fit. NOT named `onChange`
   * (that collides with RN's reserved `topChange` and crashes on render). */
  readonly onActiveHeight?: (event: NativeSyntheticEvent<{ readonly height: number }>) => void;

  // --- Part B: the composer bottom bar (apiVersion >= 2) ---
  /** Render the composer as the bottom bar inside this view, so the window
   * content (scroll + composer) is one native layout. Off → suggestions only. */
  readonly showComposer?: boolean;
  /** Render ONLY the composer row (no scroll, no glass) for the RN pill to
   * wrap — the native composer used in the existing window. */
  readonly composerOnly?: boolean;
  /** Seed text to restore a saved draft; typing is owned natively after. */
  readonly draft?: string;
  readonly placeholder?: string;
  /** Focus the field (the window is open). */
  readonly open?: boolean;
  /** Chip tints (hex strings at runtime), from composerChips' SSOT. */
  readonly plusFill?: ColorValue;
  readonly plusIcon?: ColorValue;
  readonly sendActiveFill?: ColorValue;
  readonly sendMutedFill?: ColorValue;
  /** Send the composed text (carried in the event, so JS need not mirror every
   * keystroke); JS clears its draft and sends through the outbox. */
  readonly onSend?: (event: NativeSyntheticEvent<{ readonly text: string }>) => void;
  /** Draft changed — JS mirrors it to persist across close (not per-send). */
  readonly onDraftChange?: (event: NativeSyntheticEvent<{ readonly text: string }>) => void;
  /** The + (attach) chip tapped. */
  readonly onPlus?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
  /** The collapsed bar tapped — JS opens the window. */
  readonly onOpenComposer?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
}

const nativeModule =
  Platform.OS === "ios"
    ? requireOptionalNativeModule<{ readonly apiVersion?: number }>("DubzHome")
    : null;
const apiVersion = typeof nativeModule?.apiVersion === "number" ? nativeModule.apiVersion : 0;
// 1: the suggestions surface — scroll, bottom-anchor, scroll-behind, expand,
//    row animation, all native (session area as the content).
// 2: + the composer bottom bar (Part B) can live in this view.
// 3: + composerOnly — the composer row usable in the existing RN pill.
const available = apiVersion >= 1;
/** Whether this build's native view carries the usable composer (composerOnly),
 * so JS may put the native composer in the pill. A build behind → RN composer. */
export const isDubzComposerNative = apiVersion >= 3;

/** The native Dubz home surface, or undefined where this build has none (or too old). */
export const DubzHomeNativeView: React.ComponentType<DubzHomeNativeProps> | undefined = available
  ? requireNativeView<DubzHomeNativeProps>("DubzHome")
  : undefined;

/** Whether this build carries native Dubz home (else fall back to @expo/ui). */
export const isDubzHomeNative = available;

// Probe: tells us from Metro whether the RUNNING BINARY has the native module.
// apiVersion 0 = this binary did not bundle it (a reload can't add native code —
// only installing the build that has it); >=1 = present and the native view is used.
console.log(`[dubz-home] native=${available} apiVersion=${apiVersion} viewDefined=${DubzHomeNativeView !== undefined}`);
