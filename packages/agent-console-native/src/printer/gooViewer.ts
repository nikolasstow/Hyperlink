/**
 * The printer plugin's viewer for sliced `.goo` files (viewers/fileViewers.ts):
 * the 3D model and the print's details (GooViewerScreen.tsx). It needs the
 * relay, which makes the model, so it takes files from a files-v1 endpoint.
 *
 * @internal
 */
import type { FileViewer } from "../viewers/fileViewers";

export const gooViewer: FileViewer = {
  id: "printer.goo",
  title: "3D model",
  extensions: [".goo"],
  accepts: (target) => target.endpoint !== undefined,
  open: (navigation, target) => {
    if (target.endpoint === undefined) return;
    navigation.navigate("GooViewer", { relayBase: target.endpoint, path: target.path, name: target.name });
  },
};
