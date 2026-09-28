/**
 * Going where a plugin page points: opening one of its pages by kind and
 * params, and asking before an action that removes something. Shared by the
 * page and collection screens so both open and confirm alike.
 *
 * @internal
 */
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Alert } from "react-native";
import type { PageAction, PageLink } from "./pagesClient";
import type { RootStackParamList } from "./RootNavigator";

type Navigation = Pick<NativeStackNavigationProp<RootStackParamList>, "push">;

/** Open one of the plugin's pages, drawn by its kind, with its params: a
 * collection with a group or category opens on that filter. */
export const openLink = (navigation: Navigation, repo: string, dir: string, link: PageLink): void => {
  const group = link.params["group"];
  const category = link.params["category"];
  if (link.kind === "collection") {
    navigation.push("Collection", {
      repo,
      dir,
      page: link.page,
      title: link.title,
      view:
        group === undefined && category === undefined
          ? { kind: "home" }
          : {
              kind: "filter",
              ...(group === undefined ? {} : { group }),
              ...(category === undefined ? {} : { category }),
            },
    });
  } else if (link.kind === "sections") {
    navigation.push("PluginPage", { repo, dir, page: link.page, title: link.title, params: link.params });
  } else {
    navigation.push("ExtensionView", { repo, dir, view: link.page, title: link.title });
  }
};

/** Ask before an action that removes something. */
export const confirmFirst = (action: PageAction, run: () => void): void => {
  if (action.destructive !== true) {
    run();
    return;
  }
  Alert.alert(`${action.title}?`, undefined, [
    { text: "Cancel", style: "cancel" },
    { text: action.title, style: "destructive", onPress: run },
  ]);
};
