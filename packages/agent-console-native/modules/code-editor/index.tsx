/**
 * The native code editor: a forked Runestone `TextView` (a real `UITextInput`
 * with a line tree, lazy viewport layout, and a gutter) driven entirely by
 * props. Text and per-line Shiki tokens come down; edits go back up through
 * `onChange`. One renderer for both viewing and editing — read-only is just
 * `editable={false}`. Highlighting is the vendored Shiki layer, so colours match
 * the previews and chat blocks exactly.
 *
 * `CodeEditorNativeView` is undefined in a build without the native module (it
 * lands a build ahead of being required): callers fall back to the web surface
 * until the dev client is rebuilt. `isCodeEditorNative` says which.
 *
 * @internal
 */
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type * as React from "react";
import { type NativeSyntheticEvent, Platform, type ViewProps } from "react-native";

/** One coloured run on a line: a range in UTF-16 offsets local to the line. */
export interface LineToken {
  readonly start: number;
  readonly length: number;
  readonly color?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
}

/** The editor's base colours, derived from the active VS Code theme. */
export interface EditorTheme {
  readonly background?: string;
  readonly foreground?: string;
  readonly gutterBackground?: string;
  readonly gutterForeground?: string;
  readonly currentLine?: string;
  readonly selection?: string;
  readonly caret?: string;
  /** VS Code's merge colours, for conflicts: behind your lines and the
   * agent's, the Mine/Theirs buttons, and the panel holding them. */
  readonly mergeCurrentContent?: string;
  readonly mergeIncomingContent?: string;
  readonly mergeCurrentHeader?: string;
  readonly mergeIncomingHeader?: string;
  readonly mergeCommonHeader?: string;
}

export interface CodeEditorNativeProps extends ViewProps {
  readonly text: string;
  readonly editable: boolean;
  /**
   * Tokens as JSON — `[[LineToken]]`, one inner array per line (0-based), or
   * (`apiVersion` 7) `{length, lines}` with the length of the text they were
   * made for, so tokens for older text are never laid over newer. A string,
   * not a nested-array prop: it decodes straight into the native `ShikiToken`
   * and avoids bridging arrays of records.
   */
  readonly tokensJson: string;
  /**
   * Scope ranges as JSON — `[{header,start,end,depth}]` (0-based lines) from the
   * structure provider, for sticky scroll. A string, like `tokensJson`.
   */
  readonly stickyRangesJson: string;
  readonly theme: EditorTheme;
  /** Room for the translucent bars; applied as the scroll view's content inset so
   * content scrolls under them but the first/last lines clear them. */
  readonly topInset: number;
  readonly bottomInset: number;
  /** How far down the top sticky block fills (header rests here; real lines above
   * fill up through the status bar). Tunable for alignment. */
  readonly stickyFill: number;
  readonly fontSize: number;
  readonly showLineNumbers: boolean;
  readonly wrapLines: boolean;
  /**
   * Conflicts drawn in the document: JSON `[{from,to,mine,mineTokens?}]` — the
   * agent's lines at `[from, to)` (UTF-16), and what your edit made of them
   * (`mineTokens` per line, like `tokensJson`). `apiVersion` 6 and up.
   */
  readonly conflictsJson?: string;
  readonly onTextChange?: (event: NativeSyntheticEvent<{ readonly text: string }>) => void;
  /** A conflict's button: keep yours or theirs. */
  readonly onConflictAction?: (event: NativeSyntheticEvent<{ readonly index: number; readonly keep: ConflictChoice }>) => void;
  /** Native sticky-scroll diagnostics, surfaced for Metro logs. */
  readonly onStickyDebug?: (event: NativeSyntheticEvent<Record<string, number | string>>) => void;
}

/** How a conflict is settled: your lines, or the agent's. */
export type ConflictChoice = "Mine" | "Theirs";

/** What a ref on the native view offers (`apiVersion` 5 and up). */
export interface CodeEditorHandle {
  /**
   * Apply outside changes in place, keeping the cursor and the lines on
   * screen: `changesJson` is `[{from,to,insert}]` against the current text,
   * `expectedLength` the result's length (the editor reports its text back
   * if it differs), `highlightJson` `[{from,to}]` lit for a moment.
   */
  readonly applyChanges: (changesJson: string, expectedLength: number, highlightJson: string) => Promise<void>;
}

// Gate on the native API version, not mere presence: the first build shipped an
// `onChange` event that collides with React Native's reserved `topChange` and
// crashes the instant the view config is read. That binary reports no
// `apiVersion`, so we treat it as absent and fall back to the web surface —
// which is why this fix takes effect over Metro, before a rebuild. `apiVersion`
// 2 (the renamed `onTextChange` build) is the first that's safe to mount.
const nativeModule = Platform.OS === "ios" ? requireOptionalNativeModule<{ readonly apiVersion?: number }>("CodeEditor") : null;
const apiVersion = typeof nativeModule?.apiVersion === "number" ? nativeModule.apiVersion : 0;
const available = apiVersion >= 2;

/** The native editor view, or undefined where this build has none (or too old). */
export const CodeEditorNativeView: React.ComponentType<CodeEditorNativeProps & { readonly ref?: React.Ref<CodeEditorHandle> }> | undefined = available
  ? requireNativeView<CodeEditorNativeProps & { readonly ref?: React.Ref<CodeEditorHandle> }>("CodeEditor")
  : undefined;

/** Whether this build carries a safe-to-mount native editor. */
export const isCodeEditorNative = available;

/** Whether the editor can take outside changes in place (`applyChanges`) and
 * mark conflicts. Older builds get the whole new text instead. */
export const canApplyChanges = apiVersion >= 5;

/** Whether the editor draws conflicts in the document (`conflictsJson`). */
export const canShowConflicts = apiVersion >= 6;

/** Whether the editor takes `tokensJson` as `{length, lines}` and keeps its
 * colours in step while typing. */
export const canVersionTokens = apiVersion >= 7;
