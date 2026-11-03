/**
 * One project page, as the server renders it (`/projects/view?…&env=app`):
 * the author's HTML with the page SDK (`window.da`) injected, in a WebView.
 *
 * Before the document loads, the app seeds `window.__DA__` with the server's
 * URL and its token, so `da.projects.list()` and friends reach the API from
 * inside the page. The SDK posts `navigate`, `chrome` and `context` messages
 * over the bridge:
 *
 * - `navigate` with a `da:` link opens another page or a session natively;
 *   any other link opens outside the app.
 * - `chrome` hides or shows the nav header (`fullscreen` / `framed`).
 * - `context` is read and left for Dubz to pick up later.
 *
 * The WebView itself only loads the server's own origin; a link to anywhere
 * else is handed to the system browser.
 *
 * @internal
 */
import * as React from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { WebView } from "react-native-webview";
import { useAppContext } from "./AppContext";
import { authHeaders, originOf, tokenFor } from "./auth/serverTokens";
import { base } from "./extensionsClient";
import { pageViewUrl, parseBridgeMessage, parseDaLink } from "./projectsClient";
import type { RootStackParamList } from "./RootNavigator";
import { useScreenBackground } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "ProjectPage">;

/** The `window.__DA__` seed, as a script the WebView runs before the page. */
const seedScript = (apiBase: string, token: string | undefined): string => {
  const seed = JSON.stringify({
    env: "app",
    apiBase,
    ...(token === undefined ? {} : { token }),
  });
  return `window.__DA__ = Object.assign(${seed}, window.__DA__ || {}); true;`;
};

export const ProjectPageScreen = (props: Props): React.ReactElement => {
  const { project, slug } = props.route.params;
  const { server } = useAppContext();
  const apiBase = base(server);
  const headerHeight = useHeaderHeight();
  const background = useScreenBackground();
  const uri = pageViewUrl(apiBase, project, slug);
  const origin = originOf(apiBase);

  const onNavigate = (href: string): void => {
    const link = parseDaLink(href);
    if (link === undefined) {
      void Linking.openURL(href);
      return;
    }
    if (link.kind === "page") {
      props.navigation.push("ProjectPage", { project: link.project, slug: link.slug, title: link.slug });
    } else if (link.kind === "session") {
      props.navigation.navigate("Chat", { sessionID: link.sessionID });
    } else {
      // A file link: the files screens take a repo and a path; wiring that is
      // a follow-up, so for now the link does nothing rather than something wrong.
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <WebView
        style={[styles.web, { marginTop: headerHeight }]}
        source={{ uri, headers: authHeaders(uri) }}
        injectedJavaScriptBeforeContentLoaded={seedScript(apiBase, tokenFor(apiBase))}
        onMessage={(event) => {
          const message = parseBridgeMessage(event.nativeEvent.data);
          if (message === undefined) return;
          if (message.type === "navigate") onNavigate(message.href);
          else if (message.type === "chrome") props.navigation.setOptions({ headerShown: message.mode !== "fullscreen" });
        }}
        onShouldStartLoadWithRequest={(request) => {
          if (origin !== undefined && request.url.startsWith(origin)) return true;
          if (request.url.startsWith("about:")) return true;
          void Linking.openURL(request.url);
          return false;
        }}
        allowsBackForwardNavigationGestures={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  web: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
