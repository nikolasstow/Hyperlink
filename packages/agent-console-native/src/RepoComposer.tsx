/**
 * A repo's bottom bar: the new-session composer, as on Home, with the repo
 * fixed (its dropdown shows as static text; HomeTargetPickers `lockedRepo`).
 * The repo page and its Files page both show it. A message opens its chat.
 *
 * It floats from the screen's top down to the keyboard (or its resting
 * spot), with the bottom feather and the dim that dismisses the keyboard.
 *
 * @internal
 */
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as React from "react";
import Animated from "react-native-reanimated";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { AGENT } from "./agentConstants";
import type { Invocation } from "./commands/slash";
import { Composer } from "./Composer";
import type { DubzContext } from "./dubzSuggestions";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { HomeTargetPickers, sessionDirectory, type SessionTarget, TARGET_PICKERS_HEIGHT } from "./HomeTargetPickers";
import { KeyboardDismissOverlay } from "./KeyboardDismissOverlay";
import { serverAddressOf } from "./opencode/serverAddress";
import { Agent } from "./opencode/schema/agent";
import type { Model } from "./opencode/schema/model";
import { AbsolutePath } from "./opencode/schema/schema";
import { SessionID } from "./opencode/schema/session-id";
import { sendMessage } from "./outbox/useOutbox";
import type { ScannedRepo } from "./repoScan";
import { refreshWorkspace } from "./repoScanCache";
import type { RootStackParamList } from "./RootNavigator";
import { useKeyboardHeight } from "./useKeyboardHeight";
import { composerRestingBottom, useKeyboardSlide } from "./useKeyboardSlide";

const EMPTY_ACTIVITY: ReadonlyMap<string, number> = new Map();

export const RepoComposer = (props: {
  readonly name: string;
  readonly dir: string;
  readonly isRepo: boolean;
  /** The repos and worktrees found, for the pickers. */
  readonly scanned: ReadonlyArray<ScannedRepo>;
  /** A worktree or folder was made from the pickers: the scan, fresh. */
  readonly onScanned: (scanned: ReadonlyArray<ScannedRepo>) => void;
  /** A message went out (its chat is opening). */
  readonly onSent?: () => void;
}): React.ReactElement => {
  const { name, dir, isRepo, scanned, onScanned, onSent } = props;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { address, rootDir, backend } = useAppContext();
  const insets = useSafeAreaInsets();
  const [target, setTarget] = React.useState<SessionTarget | undefined>(undefined);
  const [sending, setSending] = React.useState(false);
  const keyboardHeight = useKeyboardHeight();
  const composerSlide = useKeyboardSlide(composerRestingBottom(insets.bottom));
  // Dubz here is about this repo; a workspace (not a repo) has no tasks.
  const dubzContext = React.useMemo(
    (): DubzContext => ({
      surface: "repo",
      scope: isRepo ? { _tag: "Repo", repo: name } : { _tag: "Folder" },
    }),
    [isRepo, name],
  );

  const onSend = React.useCallback(
    async (text: string, model: Model.Ref | undefined, invocation: Invocation | undefined): Promise<void> => {
      if (target === undefined || sending) return;
      setSending(true);
      try {
        const sessionID = SessionID.create();
        const directory = sessionDirectory(target);
        // Into the outbox: it makes the folder (if new) and the session when the
        // server can take them, then sends; the chat opens at once.
        await sendMessage({
          server: serverAddressOf(address),
          sessionID,
          directory: directory === undefined ? undefined : AbsolutePath.make(directory),
          create: target.kind === "newFolder" ? { folder: { root: rootDir, name: target.name } } : {},
          text,
          files: [],
          model,
          agent: Agent.ID.make(AGENT),
          invocation,
        });
        navigation.navigate("Chat", { sessionID });
        onSent?.();
      } finally {
        setSending(false);
      }
    },
    [target, sending, address, rootDir, navigation, onSent],
  );

  // Rescan after a worktree/workspace is created from the pickers.
  const onWorkspaceChanged = React.useCallback(async (): Promise<void> => {
    onScanned(await refreshWorkspace(backend, rootDir));
  }, [backend, rootDir, onScanned]);

  return (
    <>
      <KeyboardDismissOverlay active={keyboardHeight > 0} dim />
      {/* Only the BOTTOM feather here: the page draws its own top. */}
      <EdgeBlurBars variant="bottom" />
      <Animated.View
        // From the screen's top down to the keyboard (or the bar's resting
        // spot), letting touches through where empty: the bar sits at its
        // bottom, and Dubz's window grows up inside it, so its grab bar stays
        // within its parents' bounds, where iOS delivers touches.
        style={[styles.float, composerSlide]}
        pointerEvents="box-none"
      >
        <Composer
          onSend={onSend}
          disabled={sending || target === undefined}
          directory={target !== undefined ? sessionDirectory(target) : undefined}
          bottomInset={0}
          placeholder="Plan, ask, build…"
          dubzContext={dubzContext}
          topSection={{
            height: TARGET_PICKERS_HEIGHT,
            node: (
              <HomeTargetPickers
                scanned={scanned}
                otherFolders={[]}
                activityByName={EMPTY_ACTIVITY}
                target={target}
                onChange={setTarget}
                onWorkspaceChanged={onWorkspaceChanged}
                lockedRepo={{ name, dir, isRepo }}
              />
            ),
          }}
        />
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  float: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    // `bottom` is animated inline via composerSlide (rides the keyboard).
  },
});
