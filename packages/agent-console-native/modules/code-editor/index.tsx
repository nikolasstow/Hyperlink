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
}

export interface CodeEditorNativeProps extends ViewProps {
  readonly text: string;
  readonly editable: boolean;
  /**
   * Tokens as JSON — `[[LineToken]]`, one inner array per line (0-based). A
   * string, not a nested-array prop: it decodes straight into the native
   * `ShikiToken` and avoids bridging arrays of records.
   */
  readonly tokensJson: string;
  readonly theme: EditorTheme;
  readonly fontSize: number;
  readonly showLineNumbers: boolean;
  readonly wrapLines: boolean;
  readonly onChange?: (event: NativeSyntheticEvent<{ readonly text: string }>) => void;
}

const available = Platform.OS === "ios" && requireOptionalNativeModule("CodeEditor") !== null;

/** The native editor view, or undefined where this build has none. */
export const CodeEditorNativeView: React.ComponentType<CodeEditorNativeProps> | undefined = available
  ? requireNativeView<CodeEditorNativeProps>("CodeEditor")
  : undefined;

/** Whether this build carries the native editor. */
export const isCodeEditorNative = available;
