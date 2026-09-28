/**
 * Carrying out what a view or page action asked for, the same way everywhere:
 * a task runs on the backend's process runner and opens its live output, a
 * file opens in the viewer, and anything the action said is shown.
 *
 * @internal
 */
import type { NavigationProp } from "@react-navigation/native";
import { Alert } from "react-native";
import { startTask, type InvokeResult } from "./extensionViewsClient";
import type { RootStackParamList } from "./RootNavigator";

export const followResult = async (
  navigation: NavigationProp<RootStackParamList>,
  apiBase: string,
  result: InvokeResult,
  title: string,
): Promise<void> => {
  switch (result._tag) {
    case "RunTask": {
      const id = await startTask(apiBase, result);
      navigation.navigate("ProcessOutput", {
        id,
        title: result.name,
        commandLine: [result.command, ...result.args].join(" "),
      });
      return;
    }
    case "OpenFile":
      navigation.navigate("FileViewer", {
        path: result.path,
        name: result.path.split("/").at(-1) ?? result.path,
        ...(result.line === undefined ? {} : { line: result.line }),
      });
      return;
    case "Completed":
      if (result.messages.length > 0) Alert.alert(title, result.messages.join("\n"));
      return;
  }
};
