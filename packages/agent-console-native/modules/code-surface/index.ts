/**
 * The native host for the code surface: a pool of `WKWebView`s that outlive the
 * screens showing them.
 *
 * The page is megabytes of Monaco and Shiki and costs most of a second to
 * parse. React Native cannot move a native view between parents, so a web view
 * owned by a screen dies with it and the next file pays that parse again. This
 * module keeps them warm, and lets a document be opened before anyone taps the
 * file.
 *
 * iOS only, and only in a build that carries it. `isCodeSurfaceNative` says
 * which, because the module lands a build ahead of being required: until then
 * the caller falls back to `react-native-webview`, the same way `HtmlToolBlock`
 * treats `expo-web-browser`.
 *
 * @internal
 */
import { requireNativeModule, requireNativeView } from "expo";
import type * as React from "react";
import { Platform, type ViewProps } from "react-native";

export interface CodeSurfaceNativeProps extends ViewProps {
  /** The page, as a `file://` URL resolved from the Metro asset. */
  readonly sourceUrl: string;
  readonly onSurfaceMessage?: (event: { readonly nativeEvent: { readonly data: string } }) => void;
}

/** What a ref on the native view offers: one host message, evaluated inside. */
export interface CodeSurfaceHandle {
  readonly send: (script: string) => Promise<void>;
}

interface CodeSurfaceNativeModule {
  readonly warm: (count: number, sourceUrl: string) => Promise<void>;
}

const load = <A,>(read: () => A): A | undefined => {
  try {
    return read();
  } catch {
    // Not in this binary yet. The caller falls back.
    return undefined;
  }
};

const nativeModule = Platform.OS === "ios" ? load(() => requireNativeModule<CodeSurfaceNativeModule>("CodeSurface")) : undefined;

export const CodeSurfaceNativeView =
  Platform.OS === "ios"
    ? load(() => requireNativeView<CodeSurfaceNativeProps & { readonly ref?: React.Ref<CodeSurfaceHandle> }>("CodeSurface"))
    : undefined;

/** Whether this build can host the surface natively. */
export const isCodeSurfaceNative = nativeModule !== undefined && CodeSurfaceNativeView !== undefined;

/**
 * Build surfaces ahead of the first file. Idempotent, and a no-op on a build
 * without the module, so a caller never has to check first.
 */
export const warmCodeSurfaces = async (count: number, sourceUrl: string): Promise<void> => {
  if (nativeModule === undefined) return;
  await nativeModule.warm(count, sourceUrl).catch(() => undefined);
};
