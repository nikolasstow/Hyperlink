/**
 * File viewers and editors from plugins. Each one says which file types it
 * takes; every page that browses files (the shared explorer's hosts) asks
 * here first, so a plugin's viewer works wherever files show. A file that no
 * plugin takes opens as the page did before (the code view, the details).
 *
 * A plugin adds its viewers to {@link FILE_VIEWERS}. The printer plugin's
 * `.goo` viewer is the first (printer/gooViewer.ts).
 *
 * See docs/handoffs/plugin-devices-files-editors.md (decision 25).
 *
 * @internal
 */
import type { NavigationProp } from "@react-navigation/native";
import { gooViewer } from "../printer/gooViewer";
import type { RootStackParamList } from "../RootNavigator";

/** A file a viewer may open: its source's files-v1 endpoint (when the source has one), its path there, and its name. */
export interface ViewerTarget {
  readonly endpoint: string | undefined;
  readonly path: string;
  readonly name: string;
}

export interface FileViewer {
  readonly id: string;
  /** What Open With would call it. */
  readonly title: string;
  /** File name endings it takes, in lower case with the dot, such as `.goo`. */
  readonly extensions: ReadonlyArray<string>;
  /** Whether it can open this file, past its type: for example, it needs a files-v1 endpoint. */
  readonly accepts: (target: ViewerTarget) => boolean;
  /** Opens the file: pushes the viewer's page. */
  readonly open: (navigation: NavigationProp<RootStackParamList>, target: ViewerTarget) => void;
}

/** Every plugin's viewers, first match first. */
export const FILE_VIEWERS: ReadonlyArray<FileViewer> = [gooViewer];

/** The viewer that opens `target`, if a plugin has one for it. */
export const viewerFor = (target: ViewerTarget, viewers: ReadonlyArray<FileViewer> = FILE_VIEWERS): FileViewer | undefined => {
  const name = target.name.toLowerCase();
  return viewers.find((viewer) => viewer.extensions.some((extension) => name.endsWith(extension)) && viewer.accepts(target));
};
