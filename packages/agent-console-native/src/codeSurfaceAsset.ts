/**
 * Where the code surface page lives on disk.
 *
 * Resolved once and shared, because two callers need it and neither should
 * race the other: the surface itself, and whatever warms the native pool before
 * a file is ever opened.
 *
 * Metro treats the page as an asset, so in a release build it is a file inside
 * the app bundle and in development it is a packager download. `downloadAsync`
 * resolves both to a local file, which is what both the WebView host and the
 * native host load.
 *
 * @internal
 */
import { Asset } from "expo-asset";
import surfaceHtml from "../assets/code-surface.html";

let pending: Promise<string> | undefined;

/**
 * The page's `file://` URL. The promise is kept rather than the value, so a
 * second caller arriving mid-flight waits on the first rather than starting
 * again. A failure is not cached: the next caller retries.
 */
export const codeSurfaceUri = async (): Promise<string> => {
  if (pending === undefined) {
    pending = Asset.fromModule(surfaceHtml)
      .downloadAsync()
      .then((asset) => {
        const local = asset.localUri ?? asset.uri;
        if (local.length === 0) throw new Error("The code surface asset resolved to no file.");
        return local;
      })
      .catch((cause: unknown) => {
        pending = undefined;
        throw cause instanceof Error ? cause : new Error(String(cause));
      });
  }
  return pending;
};
