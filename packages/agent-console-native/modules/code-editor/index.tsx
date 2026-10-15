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
  /** A conflict's colours, from the theme (mergeColors.ts): behind your
   * lines and the agent's, the Mine/Theirs buttons, and their labels. */
  readonly mergeCurrentContent?: string;
  readonly mergeIncomingContent?: string;
  readonly mergeCurrentHeader?: string;
  readonly mergeIncomingHeader?: string;
  readonly mergeLabel?: string;
  /** An agent's change (changeColors.ts): the gutter stripes for added and
   * changed lines, the wedge where lines were deleted, the flash as it
   * lands, and the label on the popover's button. */
  readonly changeAdded?: string;
  readonly changeModified?: string;
  readonly changeDeleted?: string;
  readonly changeFlash?: string;
  readonly changeLabel?: string;
  /** Whether the theme is light: glass drawn in the editor takes this
   * appearance, not the phone's. */
  readonly light?: boolean;
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
  /** Open session on an agent change's popover (`apiVersion` 8). */
  readonly onOpenSession?: (event: NativeSyntheticEvent<{ readonly sessionID: string }>) => void;
  /** The code's font family; the system's monospace while it is not
   * installed (`apiVersion` 11). */
  readonly fontFamily?: string;
  /** Where the code rests once laid out, points from its top (a file
   * reopening where it was left; `apiVersion` 12). */
  readonly initialOffset?: number;
  /** Where the code rests across once laid out, points from its left
   * (`apiVersion` 13). */
  readonly initialOffsetX?: number;
  /** Where the code came to rest after a scroll, points from its top
   * (`offset`) and its left (`offsetX`, from `apiVersion` 13). */
  readonly onScrollRest?: (event: NativeSyntheticEvent<{ readonly offset: number; readonly offsetX?: number }>) => void;
  /** The line you are at (0-based), when it changes: the caret's while
   * editing, else the top of the visible code (`apiVersion` 10). */
  readonly onLineChange?: (event: NativeSyntheticEvent<{ readonly line: number }>) => void;
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
  /**
   * Mark lines an agent changed, in the gutter, until the file is closed
   * (`apiVersion` 8): `marksJson` is `[{kind,from,to,sessionID?,title?,at}]`
   * against the current text — `kind` "added", "modified" or "deleted" (a
   * point between lines), `at` when it landed (ms since 1970).
   */
  readonly markChanges: (marksJson: string) => Promise<void>;
}

// Gate on the native API version, not mere presence: the first build shipped an
// `onChange` event that collides with React Native's reserved `topChange` and
// crashes the instant the view config is read. That binary reports no
// `apiVersion`, so we treat it as absent and fall back to the web surface —
// which is why this fix takes effect over Metro, before a rebuild. `apiVersion`
// 2 (the renamed `onTextChange` build) is the first that's safe to mount.
const nativeModule =
  Platform.OS === "ios"
    ? requireOptionalNativeModule<{
        readonly apiVersion?: number;
        readonly hideKeyboard?: () => Promise<boolean>;
        readonly showKeyboard?: () => Promise<boolean>;
        readonly registerFont?: (uri: string) => Promise<ReadonlyArray<string>>;
        readonly unregisterFont?: (uri: string) => Promise<void>;
        readonly textImage?: (text: string, family: string, size: number, width: number, height: number, color: string) => Promise<string>;
        readonly renderPreview?: (options: EditorPreviewOptions) => Promise<string>;
      }>("CodeEditor")
    : null;
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

/** Whether the editor marks an agent's changes in the gutter (`markChanges`). */
export const canMarkChanges = apiVersion >= 8;

/** Put the keyboard down but keep editing the file being edited (the caret
 * stays; `apiVersion` 9). False when no file is being edited, or this build
 * can't. */
export const hideEditorKeyboard = (): Promise<boolean> =>
  apiVersion >= 9 && nativeModule?.hideKeyboard !== undefined ? nativeModule.hideKeyboard() : Promise.resolve(false);

/** Whether the editor draws in a chosen family (`fontFamily`) and custom
 * fonts can be installed from files (`apiVersion` 11). */
export const canInstallFonts = apiVersion >= 11;

/** Register the font file at `uri` for the app; its families. */
export const registerFont = (uri: string): Promise<ReadonlyArray<string>> =>
  canInstallFonts && nativeModule?.registerFont !== undefined ? nativeModule.registerFont(uri) : Promise.reject(new Error("This build cannot install fonts"));

/** Unregister the font file at `uri` (a font being removed). */
export const unregisterFont = (uri: string): Promise<void> =>
  canInstallFonts && nativeModule?.unregisterFont !== undefined ? nativeModule.unregisterFont(uri) : Promise.resolve();

/** `text` drawn in the code font for `family` (the system's monospace while
 * it is not installed) at `size` points, bottom-centred in a `width` ×
 * `height` box, in `color`: the image file's URI. Undefined on a build that
 * cannot (`apiVersion` 11). */
export const textImage = (text: string, family: string, size: number, width: number, height: number, color: string): Promise<string | undefined> =>
  canInstallFonts && nativeModule?.textImage !== undefined ? nativeModule.textImage(text, family, size, width, height, color) : Promise.resolve(undefined);

/** What a preview draws: everything the editor is given on screen, and
 * where it rests. */
export interface EditorPreviewOptions {
  /** The image's name: the same key is the same picture. */
  readonly key: string;
  readonly text: string;
  readonly tokensJson: string;
  readonly stickyRangesJson: string;
  readonly theme: EditorTheme;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly width: number;
  readonly height: number;
  readonly topInset: number;
  readonly bottomInset: number;
  readonly stickyFill: number;
  /** Points from the code's top it rests at. */
  readonly offset: number;
  /** Points from the code's left it rests at (`apiVersion` 13). */
  readonly offsetX: number;
  /** Pixels per point of the image. */
  readonly scale: number;
}

/** Whether the editor can draw previews of itself (`apiVersion` 12). */
export const canRenderPreviews = apiVersion >= 12;

/** A file as the editor shows it, drawn by the editor itself: the image
 * file's URI. Undefined on a build that cannot. */
export const renderPreview = (options: EditorPreviewOptions): Promise<string | undefined> =>
  canRenderPreviews && nativeModule?.renderPreview !== undefined ? nativeModule.renderPreview(options) : Promise.resolve(undefined);

/** Bring the keyboard back to a file kept editing without it. False when
 * there is none. */
export const showEditorKeyboard = (): Promise<boolean> =>
  apiVersion >= 9 && nativeModule?.showKeyboard !== undefined ? nativeModule.showKeyboard() : Promise.resolve(false);
