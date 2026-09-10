/**
 * The rendered output of the `render_html` tool.
 *
 * A real WebView, not `react-native-render-html`: that renderer maps tags to
 * native views with no CSS engine and no JavaScript, so anything with a real
 * layout comes out as an approximation. This is the path for when the page
 * should look like the page.
 *
 * Sandboxed on purpose — the markup is written by an agent:
 *
 * - Content is loaded as a string, so the document's origin is `about:blank`
 *   rather than anything with access to a real origin's storage or cookies.
 *   Note this also means relative `src`/`href` in a rendered *file* will not
 *   resolve; self-contained documents are the supported case.
 * - Navigation is refused. Tapping a link cannot silently take the view
 *   somewhere remote; the URL is surfaced for the reader to open deliberately.
 * - Scripts are off unless the tool call explicitly asked for them.
 *
 * @internal
 */
import * as React from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { WebView } from "react-native-webview";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { SystemIcon } from "./SystemIcon";

declare const require: (moduleName: string) => unknown;

/** SFSafariViewController via expo-web-browser. A real in-app Safari — with a
 * built-in "open in Safari" button — for the hosted preview. */
type WebBrowserApi = { readonly openBrowserAsync: (url: string) => Promise<unknown> };

let webBrowser: WebBrowserApi | undefined;
let webBrowserTried = false;

/** Loaded with `require`, guarded: expo-web-browser is a native module that may
 * not be in the current binary yet. When it isn't, we fall back to opening the
 * hosted URL in the Safari app (Linking) — which works precisely because the
 * page is hosted — and upgrade to the in-app Safari view after the next build. */
const loadWebBrowser = (): WebBrowserApi | undefined => {
  if (webBrowserTried) return webBrowser;
  webBrowserTried = true;
  try {
    const loaded = require("expo-web-browser");
    if (typeof loaded === "object" && loaded !== null && typeof (loaded as WebBrowserApi).openBrowserAsync === "function") {
      webBrowser = loaded as WebBrowserApi;
    }
  } catch {
    // Not in this build; the Linking fallback covers it.
  }
  return webBrowser;
};

const openHosted = (url: string): void => {
  const browser = loadWebBrowser();
  if (browser !== undefined) {
    void browser.openBrowserAsync(url).catch(() => Linking.openURL(url));
    return;
  }
  void Linking.openURL(url);
};

/** Collapsed height. Pages are their own thing inside a chat — full height
 * would swallow the transcript. */
const PREVIEW_HEIGHT = 260;
const EXPANDED_HEIGHT = 560;

export type HtmlPayload = {
  readonly html: string;
  readonly title?: string;
  readonly path?: string;
  readonly allowScripts: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Reads the tool's metadata defensively — it crosses a server boundary and
 * is typed as an open record, so nothing here can be assumed. */
export const asHtmlPayload = (metadata: unknown): HtmlPayload | undefined => {
  if (!isRecord(metadata) || metadata.kind !== "html") return undefined;
  if (typeof metadata.html !== "string" || metadata.html === "") return undefined;
  return {
    html: metadata.html,
    title: typeof metadata.title === "string" ? metadata.title : undefined,
    path: typeof metadata.path === "string" ? metadata.path : undefined,
    allowScripts: metadata.allowScripts === true,
  };
};

export const HtmlToolBlock = (props: { readonly payload: HtmlPayload }): React.ReactElement => {
  const { payload } = props;
  const { backend } = useAppContext();
  const [expanded, setExpanded] = React.useState(false);
  const [blockedUrl, setBlockedUrl] = React.useState<string | undefined>(undefined);
  const [opening, setOpening] = React.useState(false);
  const [serveError, setServeError] = React.useState<string | undefined>(undefined);

  // Host the page so it opens with a real origin (scripts, fetch, storage) in a
  // Safari view, rather than the origin-less inline preview. The full HTML is
  // posted rather than a path so it works whether or not the tool wrote a file.
  const openInSafari = React.useCallback(async (): Promise<void> => {
    if (opening) return;
    setOpening(true);
    setServeError(undefined);
    try {
      const response = await fetch(`${backend}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ html: payload.html }),
      });
      if (!response.ok) {
        setServeError(`Preview server returned ${response.status}`);
        return;
      }
      const result: unknown = await response.json();
      const path = isRecord(result) && typeof result.path === "string" ? result.path : undefined;
      if (path === undefined) {
        setServeError("Preview server returned no URL");
        return;
      }
      openHosted(`${backend}${path}`);
    } catch (error: unknown) {
      setServeError(`Couldn't reach the preview server: ${String(error)}`);
    } finally {
      setOpening(false);
    }
  }, [backend, opening, payload.html]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerMain} activeOpacity={0.6} onPress={() => setExpanded((open) => !open)}>
          <SystemIcon name="safari" size={13} color={colors.secondaryLabel} />
          <Text style={styles.title} numberOfLines={1}>
            {payload.title ?? payload.path ?? "Rendered HTML"}
          </Text>
          {payload.allowScripts ? <Text style={styles.badge}>JS</Text> : null}
          <SystemIcon name={expanded ? "chevron.up" : "chevron.down"} size={12} color={colors.secondaryLabel} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.openButton} activeOpacity={0.6} disabled={opening} onPress={() => void openInSafari()}>
          <SystemIcon name="safari" size={13} color={colors.tint} />
          <Text style={styles.openText}>{opening ? "Opening…" : "Open"}</Text>
        </TouchableOpacity>
      </View>

      {serveError === undefined ? null : (
        <Text style={styles.errorText} numberOfLines={2}>
          {serveError}
        </Text>
      )}

      <WebView
        style={[styles.web, { height: expanded ? EXPANDED_HEIGHT : PREVIEW_HEIGHT }]}
        originWhitelist={["about:*"]}
        source={{ html: payload.html }}
        javaScriptEnabled={payload.allowScripts}
        // Everything except the initial in-memory document is refused, so a
        // link cannot navigate this view off to a remote page.
        onShouldStartLoadWithRequest={(request) => {
          if (request.url.startsWith("about:")) return true;
          setBlockedUrl(request.url);
          return false;
        }}
        scrollEnabled
        nestedScrollEnabled
      />

      {blockedUrl === undefined ? null : (
        <TouchableOpacity
          style={styles.blocked}
          activeOpacity={0.6}
          onPress={() => openHosted(blockedUrl)}
        >
          <Text style={styles.blockedText} numberOfLines={1}>
            Open {blockedUrl} in Safari
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: colors.fillBackground,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  headerMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  openButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 8,
  },
  openText: {
    color: colors.tint,
    fontSize: 13,
    fontWeight: "600",
  },
  errorText: {
    color: colors.secondaryLabel,
    fontSize: 12,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  title: {
    flex: 1,
    color: colors.label,
    fontSize: 13,
    fontWeight: "600",
  },
  badge: {
    color: colors.secondaryLabel,
    fontSize: 10,
    fontWeight: "700",
  },
  web: {
    backgroundColor: "#FFFFFF",
  },
  blocked: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  blockedText: {
    color: colors.tint,
    fontSize: 12,
  },
});
