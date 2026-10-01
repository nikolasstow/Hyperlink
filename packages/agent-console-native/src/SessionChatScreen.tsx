/**
 * A session's chat transcript — ported from
 * packages/agent-console/src/pages/SessionChat.tsx.
 *
 * The header is the real UINavigationBar (see RootNavigator), transparent
 * and empty apart from the system back button, a title set from this
 * screen's own state, and a native "more" item. It exists so iOS 26's
 * scroll edge effect has a bar to anchor to — that blur only renders where
 * scrolling content meets a bar. An earlier version floated custom glass
 * pieces over the screen with the header hidden, which meant no blur was
 * possible at all.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { DubzContext } from "./dubzSuggestions";
import * as React from "react";
import { ActionSheetIOS, Alert, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, Vibration, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollViewMarker } from "react-native-screens/src/components/gamma/scroll-view-marker";
import { useAppContext } from "./AppContext";
import { chatMessageOfV1 } from "./chat/fromV1";
import { chatMessageOfQueued } from "./chat/fromOutbox";
import { answering, answerStartedAt, type ChatMessage } from "./chat/model";
import { useV2Transcript } from "./chat/useV2Transcript";
import { runApp } from "./effect/runtime";
import { serverAddressOf } from "./opencode/serverAddress";
import { Agent } from "./opencode/schema/agent";
import { Model } from "./opencode/schema/model";
import { Provider } from "./opencode/schema/provider";
import { AbsolutePath } from "./opencode/schema/schema";
import { SessionID } from "./opencode/schema/session-id";
import { SessionMessage } from "./opencode/schema/session-message";
import type { Protocol } from "./outbox/model";
import { removeQueued, retryLane, sendMessage, useLane } from "./outbox/useOutbox";
import { interruptSession, sessionProtocol } from "./sessions/protocol";
import { AGENT } from "./client";
import { promptRenameSession } from "./sessionActions";
import { BUSY_ROW_GAP, BUSY_ROW_HEIGHT, BusyRow } from "./BusyRow";
import { startLiveActivity } from "../modules/live-activity";
import { CollapsiblePartsProvider } from "./CollapsibleParts";
import { ROW_GUTTER } from "./layout";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { KeyboardDismissOverlay } from "./KeyboardDismissOverlay";
import { MESSAGE_GAP, MessageBubble, RECEIPT_HEIGHT } from "./MessageBubble";
import { dateHeaders } from "./chat/dateHeaders";
import { latestReceipt } from "./chat/receipt";
import type { Arrival } from "./messageArrival";
import { PermissionPrompt } from "./PermissionPrompt";
import { setViewedSession } from "./push";
import { markSessionRead } from "./sessionReads";
import { getPermissionMode, setPermissionMode, type PermissionMode } from "./sessionPermissions";
import type { RootStackParamList } from "./RootNavigator";
import { barExtra, type BarGeometry, useBarGeometry } from "./barGeometry";
import { Composer } from "./Composer";
import { COMPOSER_BAR_HEIGHT } from "./composerBarSpec";
import { FILE_CHIPS_HEIGHT, FileChips } from "./FileChips";
import { sessionFiles, type SessionFile } from "./sessionFiles";
import type { ModelOption } from "./models";
import { findModel, listModels } from "./models";
import { SessionHeaderTitle } from "./SessionHeaderTitle";
import { useKeyboardHeightValue } from "./keyboardHeight";
import { useKeyboardHeight } from "./useKeyboardHeight";
import { composerRestingBottom, useKeyboardSlide } from "./useKeyboardSlide";
import { useSessionStream } from "./useSessionStream";
import { useStreamEnabled } from "./useStreamEnabled";
import { type TextColors, useThemedStyles } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

/** Dubz in a session: its suggestions pick a repo, for now. */
const SESSION_DUBZ: DubzContext = {
  surface: "session",
  scope: { kind: "all" },
};

/** The gap between the bar's room and the rows above it. */
const BAR_SPACE_GAP = 8;
/** The longest the input waits for its bubble to show before clearing. */
const ARRIVAL_WAIT_MS = 250;

/** Within this of the newest message, a new one scrolls into view. */
const NEAR_NEWEST = 80;

/** Sentinel row id for the pending-permission bubble. Prefixed so it can
 * never collide with a real message id (`msg_…`). */
const PERMISSION_ROW_ID = "__permission__";

export const SessionChatScreen = (props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const { client, address } = useAppContext();
  const sessionID = props.route.params.sessionID;
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  // Reanimated keyboard tracking so the floating composer rides the keyboard
  // exactly (real position each frame). The list padding / blur bars keep the
  // plain number (behind it, where a snap is invisible).
  const composerSlide = useKeyboardSlide(composerRestingBottom(insets.bottom));
  // Transparent header, so content sits under it and pads itself by the
  // header's real height. On this inverted list that padding is
  // `paddingBottom` — see the contentContainerStyle note below.
  const topBarHeight = useHeaderHeight();
  const streamEnabled = useStreamEnabled();

  // A banner for the session you are looking at is noise. Synchronous module
  // state, so it cannot race the way a reported-to-the-server flag did.
  // `streamEnabled` already means "this chat is focused and the app is
  // foregrounded", which is exactly when the banner is redundant.
  React.useEffect(() => {
    setViewedSession(streamEnabled ? sessionID : undefined);
    // Mark read on open and again on leave (catching any activity while open),
    // so it drops out of the Unread section on the repo/home screens.
    void markSessionRead(sessionID, Date.now());
    return () => {
      setViewedSession(undefined);
      void markSessionRead(sessionID, Date.now());
    };
  }, [streamEnabled, sessionID]);
  // The live connection: a v1 session's conversation, and permission asks
  // (both APIs' asks come over it, so it runs for a v2 session too).
  const { transcript, pendingPermission, replyPermission, clearBusy, connected, refresh } = useSessionStream(client, sessionID, address, streamEnabled);

  // Which API the session is spoken to over (sessions/protocol.ts): known
  // when the app just made it, found out otherwise.
  const server = React.useMemo(() => serverAddressOf(address), [address]);
  const session = React.useMemo(() => SessionID.make(sessionID), [sessionID]);
  const [protocol, setProtocol] = React.useState<Protocol | undefined>(props.route.params.protocol);
  React.useEffect(() => {
    if (protocol !== undefined) return undefined;
    let cancelled = false;
    void runApp(sessionProtocol(server, session)).then((found) => {
      if (!cancelled) setProtocol(found);
    });
    return () => {
      cancelled = true;
    };
  }, [server, session, protocol]);

  // The conversation (what the server has), then what is still in the
  // outbox, until the server has it too (same id) and the
  // conversation shows it.
  const v2Messages = useV2Transcript(server, session, protocol === "v2" && streamEnabled);
  const delivered = React.useMemo(
    (): ReadonlyArray<ChatMessage> =>
      protocol === "v2"
        ? v2Messages
        : transcript.order.flatMap((id) => {
            const message = transcript.messages.get(id);
            return message === undefined ? [] : [chatMessageOfV1(message)];
          }),
    [protocol, v2Messages, transcript],
  );
  const lane = useLane(server, session);
  const messages = React.useMemo((): ReadonlyArray<ChatMessage> => {
    const known = new Set(delivered.map((message) => message.id));
    const waiting = (lane?.messages ?? []).filter((message) => !known.has(message.id)).map(chatMessageOfQueued);
    return waiting.length === 0 ? delivered : [...delivered, ...waiting];
  }, [delivered, lane]);
  const byID = React.useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const receipt = React.useMemo(() => latestReceipt(messages, lane?.held?.messageID), [messages, lane]);
  const headers = React.useMemo(() => dateHeaders(messages), [messages]);
  // Busy: v2 from the conversation (the answer still being written); v1 from
  // the live connection's run status.
  const busy = protocol === "v2" ? answering(delivered) : transcript.busy;

  // The files the agent has been touching, as chips over the bar. Relative
  // paths resolve against the session's folder.
  const [directory, setDirectory] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    let cancelled = false;
    client.session.get({ path: { id: sessionID } }).then(
      ({ data }) => {
        if (!cancelled && data !== undefined) setDirectory(data.directory);
      },
      (error: unknown) => console.error("[chat] reading the session's folder failed", error),
    );
    return () => {
      cancelled = true;
    };
  }, [client, sessionID]);
  // Every file seen this session stays: a transcript that reloads or
  // reconnects (briefly empty) never empties the row.
  const seenFiles = React.useRef<ReadonlyArray<SessionFile>>([]);
  const touched = React.useMemo(() => {
    const current = sessionFiles(messages, directory);
    const known = new Set(current.map((file) => file.path));
    const merged = [...current, ...seenFiles.current.filter((file) => !known.has(file.path))];
    seenFiles.current = merged;
    return merged;
  }, [messages, directory]);
  // Chips selected for the next message, in the order chosen: they lead the
  // row, tinted, and go with the message as file references.
  const [selected, setSelected] = React.useState<ReadonlyArray<string>>([]);
  const [orderVersion, setOrderVersion] = React.useState(0);
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const files = React.useMemo(() => {
    const byPath = new Map(touched.map((file) => [file.path, file]));
    const chosen = selected.flatMap((path) => {
      const file = byPath.get(path);
      return file === undefined ? [] : [file];
    });
    return [...chosen, ...touched.filter((file) => !selectedSet.has(file.path))];
  }, [touched, selected, selectedSet]);
  const { width: screenWidth } = useWindowDimensions();
  // The bar's heights, which the composer animates and the list's bottom
  // space follows in the same frame.
  const barGeometry = useBarGeometry();
  const keyboardValue = useKeyboardHeightValue();
  // Your message just sent, arriving from the input.
  const [arriving, setArriving] = React.useState<{ readonly id: string; readonly arrival: Arrival } | undefined>(undefined);
  // Keyboard up: select it for the message (or unselect). Down: open it.
  const onFile = (file: SessionFile): void => {
    if (keyboardHeight === 0) {
      props.navigation.navigate("FileViewer", { path: file.path, name: file.name });
      return;
    }
    setSelected((current) => (current.includes(file.path) ? current.filter((path) => path !== file.path) : [file.path, ...current]));
    setOrderVersion((version) => version + 1);
  };
  // Mirrors the module-level store so the menu re-renders with the choice.
  const [permissionMode, setMode] = React.useState<PermissionMode>(() => getPermissionMode(sessionID));
  const [title, setTitle] = React.useState<string | undefined>(undefined);
  // Newest-first — paired with `inverted` below, which should anchor the
  // list to the newest message on its own. In practice it wasn't sticking
  // reliably, so this still explicitly re-pins to `offset: 0` (an
  // inverted list's "start", i.e. its bottom) whenever a message is
  // appended — the same role the old `scrollToEnd` played pre-inversion.
  const reversedOrder = React.useMemo(() => messages.map((message) => message.id).reverse(), [messages]);
  const listRef = React.useRef<FlatList<string>>(null);
  // The one collapsible allowed to be open by default: the most recent
  // reasoning block or tool call anywhere in the transcript. Scanned newest
  // message first so a long history costs nothing — it exits on the first hit.
  // A pending permission is a real row in the list. `reversedOrder` is
  // newest-first (the list is inverted), so prepending puts it at the visual
  // bottom — in order, where it happened.
  const listData = React.useMemo(
    () => (pendingPermission === undefined ? reversedOrder : [PERMISSION_ROW_ID, ...reversedOrder]),
    [pendingPermission, reversedOrder],
  );

  const newestCollapsibleID = React.useMemo(() => {
    for (const message of [...messages].reverse()) {
      const part = message.parts.findLast((candidate) => candidate.kind === "reasoning" || candidate.kind === "tool");
      if (part !== undefined) return part.id;
    }
    return undefined;
  }, [messages]);
  // How far the reader is from the newest message (the inverted list's
  // offset).
  const scrolledBack = React.useRef(0);
  // A new message brings the list to it only when you sent it, or you were
  // already at the newest; reading back, you stay where you are.
  const newestID = reversedOrder[0];
  const shownNewest = React.useRef(newestID);
  React.useEffect(() => {
    if (newestID === undefined || newestID === shownNewest.current) return;
    shownNewest.current = newestID;
    const yours = byID.get(newestID)?.role === "user";
    if (yours || scrolledBack.current < NEAR_NEWEST) listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [newestID, byID]);

  // Start the Live Activity when a run begins, and buzz once when it ends. The
  // app NEVER ends the activity: the server owns that (it ends on the real
  // server-side `session.idle`, reliably, even while the app is closed). Ending
  // from here — off the app's stream-driven `busy`, which flaps on reconnects /
  // replays when the chat is opened mid-run — is exactly what made the activity
  // vanish when the app was foregrounded and re-backgrounded mid-stream.
  const wasBusy = React.useRef(false);
  React.useEffect(() => {
    if (busy && !wasBusy.current) {
      // Repo/worktree are not tracked on this screen yet, so the activity
      // carries the session title alone rather than inventing a location.
      // `startLiveActivity` is a no-op if one is already running for the
      // session, so opening a session mid-run won't stack a duplicate.
      void startLiveActivity({
        sessionID,
        repo: "",
        worktree: "",
        title: title ?? "Session",
        action: "Working…",
      });
    }
    if (wasBusy.current && !busy) {
      Vibration.vibrate();
    }
    wasBusy.current = busy;
  }, [busy, sessionID, title]);

  // The activity's live content (the streamed thoughts / messages / tool labels)
  // is driven entirely by the SERVER, which watches opencode and pushes quality,
  // Apple-style labels — so it's identical whether the app is open or closed,
  // and there's no client/server race writing the same activity. The app only
  // starts the activity (above); it doesn't push content.

  const applyPermissionMode = React.useCallback(
    (next: PermissionMode) => {
      setPermissionMode(sessionID, next);
      setMode(next);
    },
    [sessionID],
  );

  // Confirmation stays an action sheet: it is a decision, not navigation, and
  // it only guards the direction that grants power. Switching back to asking
  // takes effect immediately.
  const confirmAllowAll = React.useCallback(() => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Allow all tool actions?",
        message:
          "Tools run without asking for the rest of this session, including shell commands and delegating to a subagent that has its own unrestricted permissions.",
        options: ["Allow all", "Cancel"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index === 0) applyPermissionMode("full");
      },
    );
  }, [applyPermissionMode]);

  // Rename via the shared action; apply the new title locally on success.
  const renameSession = React.useCallback(() => {
    promptRenameSession(client, sessionID, title ?? "", setTitle);
  }, [client, sessionID, title]);

  // Title and connection state are screen state, so they reach the header
  // through setOptions rather than static screen options.
  React.useEffect(() => {
    props.navigation.setOptions({
      headerTitle: () => <SessionHeaderTitle title={title ?? sessionID} connected={connected} />,
      unstable_headerRightItems: () => [
        {
          type: "menu",
          label: "More",
          icon: { type: "sfSymbol", name: "ellipsis" },
          menu: {
            items: [
              {
                type: "action",
                label: "Rename",
                description: "Change this session's name",
                onPress: () => renameSession(),
              },
              {
                type: "action",
                label: "Refresh",
                description: "Reconnect and reload this session",
                onPress: () => refresh(),
              },
              {
                type: "action",
                label: "Allow all",
                description: "Tools run without asking",
                state: permissionMode === "full" ? "on" : "off",
                // Destructive because choosing it grants shell access and
                // subagent delegation for the rest of the session.
                destructive: permissionMode !== "full",
                onPress: () => {
                  if (permissionMode !== "full") confirmAllowAll();
                },
              },
              {
                type: "action",
                label: "Ask before each action",
                description: "Each tool action waits for approval",
                state: permissionMode === "ask" ? "on" : "off",
                onPress: () => applyPermissionMode("ask"),
              },
            ],
          },
        },
      ],
    });
  }, [props.navigation, title, sessionID, connected, permissionMode, confirmAllowAll, applyPermissionMode, refresh, renameSession]);

  React.useEffect(() => {
    setTitle(undefined);
    client.session
      .get({ path: { id: sessionID } })
      .then(({ data }) => setTitle(data?.title))
      .catch(() => {
        // Non-critical — the header just shows the raw id as a fallback.
      });
  }, [client, sessionID]);

  // Abort the running turn. `clearBusy` runs regardless: if the request
  // fails the run may still be going server-side, but leaving the UI pinned
  // to "busy" with a Stop button that did nothing is worse — session.idle
  // will correct it either way.
  const onStop = async (): Promise<void> => {
    try {
      if (protocol === "v2") await runApp(interruptSession(server, session));
      else await client.session.abort({ path: { id: sessionID } });
    } finally {
      clearBusy();
    }
  };

  // A queued message: send its lane again from the first message (frees a
  // refused one to go, after whatever stopped it is fixed), or take it out.
  const onQueuedPress = React.useCallback(
    (messageID: string) => {
      const queued = lane?.messages.find((message) => message.id === messageID);
      if (queued === undefined) return;
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: lane?.held?.messageID === queued.id ? `Not sent: ${lane.held.reason}` : "Waiting to send",
          options: ["Send again", "Delete", "Cancel"],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
        },
        (index) => {
          const done =
            index === 0 ? retryLane(server, session) : index === 1 ? removeQueued(server, session, queued.id) : undefined;
          done?.catch((error: unknown) => Alert.alert("Couldn’t change the queue", error instanceof Error ? error.message : String(error)));
        },
      );
    },
    [lane, server, session],
  );

  // Into the outbox: sent from there, in order, when the server can take it
  // (sessions/../outbox). The bubble shows at once; its receipt says how far it got.
  const onSend = async (text: string, model: ModelOption | undefined): Promise<void> => {
    if (protocol === undefined) return;
    // The chips selected go with this message, as file references; the
    // selection clears.
    const attached = files.filter((file) => selectedSet.has(file.path));
    setSelected([]);
    setOrderVersion((version) => version + 1);
    // Start the Live Activity synchronously at the tap, while the app is
    // definitely foreground: ActivityKit refuses to START one from the
    // background, so waiting for the run to begin loses the race when you send
    // and immediately switch away. A no-op if one is already live.
    void startLiveActivity({
      sessionID,
      repo: "",
      worktree: "",
      title: title ?? "Session",
      action: "Working…",
    });
    const id = SessionMessage.ID.create();
    // It flies from the input when its row lands at the bottom of the list
    // as you see it: you are at the newest, and nothing sits below it.
    const landed = new Promise<void>((resolve) => {
      if (scrolledBack.current > 0 || pendingPermission !== undefined) {
        resolve();
        return;
      }
      setArriving({
        id,
        arrival: {
          geometry: barGeometry,
          keyboard: keyboardValue,
          restingBottom: composerRestingBottom(insets.bottom),
          between: (files.length > 0 ? FILE_CHIPS_HEIGHT : 0) + BAR_SPACE_GAP + (busy ? BUSY_ROW_HEIGHT + BUSY_ROW_GAP : 0) + RECEIPT_HEIGHT + MESSAGE_GAP,
          onMounted: () => {
            // Once: the row keeps it while mounted; a later mount (scrolled
            // away and back) does not arrive again.
            setArriving(undefined);
            resolve();
          },
        },
      });
    });
    await sendMessage({
      id,
      server,
      sessionID: session,
      protocol,
      directory: directory === undefined ? undefined : AbsolutePath.make(directory),
      text,
      files: attached.map((file) => ({ path: file.path, name: file.name })),
      model: model === undefined ? undefined : Model.Ref.make({ providerID: Provider.ID.make(model.providerID), id: Model.ID.make(model.modelID) }),
      agent: Agent.ID.make(AGENT),
    });
    // The input clears as its bubble mounts behind it; not later than this
    // even if the row is slow to show.
    await Promise.race([landed, new Promise<void>((resolve) => setTimeout(resolve, ARRIVAL_WAIT_MS))]);
  };

  // The model the conversation was last answered with, for the composer.
  const seedModel = React.useMemo((): ModelOption | undefined => {
    const model = messages.findLast((message) => message.role === "assistant" && message.model !== undefined)?.model;
    return model === undefined ? undefined : { providerID: model.providerID, providerName: model.providerID, modelID: model.modelID, name: model.modelID };
  }, [messages]);

  const [resolvedSeed, setResolvedSeed] = React.useState<ModelOption | undefined>(undefined);
  React.useEffect(() => {
    if (seedModel === undefined) {
      setResolvedSeed(undefined);
      return;
    }
    let cancelled = false;
    void listModels(client, directory).then((options) => {
      if (cancelled) return;
      setResolvedSeed(findModel(options, seedModel.providerID, seedModel.modelID) ?? seedModel);
    });
    return () => {
      cancelled = true;
    };
  }, [client, directory, seedModel?.providerID, seedModel?.modelID]); // eslint-disable-line react-hooks/exhaustive-deps

  // No `paddingBottom: keyboardHeight` on root — the composer is
  // absolutely positioned, and absolute children weren't being offset by
  // that padding (they sat behind the keyboard instead), so both the
  // composer and the list account for the keyboard explicitly below
  // rather than relying on padding-box positioning semantics.
  return (
    <CollapsiblePartsProvider newestID={newestCollapsibleID}>
    <View style={styles.root}>
      {/* Marks this list for iOS 26's scroll edge effect. Both edges are
        * set because the list is `inverted` (a scaleY(-1) transform), so
        * its native top edge is the visual bottom — targeting one edge
        * would mean guessing at that mapping. */}
      <ScrollViewMarker style={styles.flex} scrollEdgeEffects={{ top: "soft", bottom: "soft" }}>
      <FlatList
        ref={listRef}
        inverted
        onScroll={(event) => {
          scrolledBack.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
        // No automatic insets: the list is inverted, so iOS's header inset
        // (at the scroll view's native top) landed at the visual bottom, on top
        // of the bar's room, and "scroll to newest" (offset 0) stopped short of
        // it, leaving blank space below. The padding below is exact instead;
        // the scroll edge effect comes from ScrollViewMarker, as on Home.
        contentInsetAdjustmentBehavior="never"
        style={styles.flex}
        data={listData}
        keyExtractor={(id) => id}
        renderItem={({ item }) => {
          if (item === PERMISSION_ROW_ID) {
            return pendingPermission === undefined ? null : (
              <PermissionPrompt
                pending={pendingPermission}
                onReply={(reply) => {
                  replyPermission(reply).catch((error: unknown) =>
                    Alert.alert("Couldn’t answer the permission", error instanceof Error ? error.message : String(error)),
                  );
                }}
              />
            );
          }
          const message = byID.get(item);
          if (message === undefined) return null;
          const queued = message.queued === true;
          // Still in the outbox: a tap offers to send it again now (or, for one
          // the server refused, after a fix) or take it out. The same element
          // once delivered, so the bubble stays mounted (its arrival runs on).
          return (
            <Pressable
              accessibilityRole={queued ? "button" : undefined}
              accessibilityLabel={queued ? "Queued message" : undefined}
              disabled={!queued}
              onPress={() => onQueuedPress(message.id)}
            >
              <MessageBubble
                message={message}
                arrival={arriving?.id === message.id ? arriving.arrival : undefined}
                receipt={receipt?.messageID === message.id ? receipt.receipt : undefined}
                dateHeader={headers.get(message.id)}
              />
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>Ask a question, or ask it to make a change.</Text>}
        // Below the newest message, not above the oldest — the header, not
        // the footer, is what renders nearest the (inverted) start of the
        // list, which an inverted list pins to the bottom of the screen.
        // The bar's room is the header's last child, at the very bottom.
        ListHeaderComponent={
          <>
            {busy ? <BusyRow onStop={onStop} startedAt={answerStartedAt(messages)} /> : null}
            <BarSpace geometry={barGeometry} restingBottom={composerRestingBottom(insets.bottom)} chips={files.length > 0 ? FILE_CHIPS_HEIGHT : 0} />
          </>
        }
        // `inverted` flips the whole content area as a unit, so these are
        // swapped from how they read: `paddingBottom` — normally "space
        // after the last item" — renders as reserved space at the screen's
        // visual TOP (under the header), and `paddingTop`
        // renders at the visual BOTTOM (under the floating composer).
        // The visual bottom is BarSpace, in the header.
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: topBarHeight + 16,
            paddingTop: 0,
          },
        ]}
      />
      </ScrollViewMarker>
      <EdgeBlurBars busy={busy} />
      {/* While the keyboard is up, one tap outside the composer only collapses
       * it (consumed here) instead of hitting a message/row behind it. */}
      <KeyboardDismissOverlay active={keyboardHeight > 0} />
      {/* Absolutely positioned, not a flex sibling — otherwise it takes
       * layout space away from the list and nothing ever passes behind
       * it, which defeats the glass. `bottom` tracks the keyboard
       * explicitly: absolute children here are NOT offset by the parent's
       * padding (relying on that put the composer behind the keyboard). */}
      {/* From the screen's top down to the keyboard (or the bar's resting
       * spot), letting touches through where empty: the bar sits at its bottom,
       * and Dubz's window grows up inside it, so its grab bar stays within its
       * parents' bounds, where iOS delivers touches. */}
      <Animated.View style={[styles.composerFloat, composerSlide]} pointerEvents="box-none">
        <Composer
          onSend={onSend}
          // v2: send any time (the server holds a message until the agent is
          // free). v1 would hand it to the running turn, so it waits for idle.
          disabled={protocol === undefined || (protocol === "v1" && transcript.busy)}
          directory={directory}
          bottomInset={0}
          placeholder="Message"
          seedModel={resolvedSeed}
          dubzContext={SESSION_DUBZ}
          geometry={barGeometry}
          accessory={<FileChips files={files} selected={selectedSet} orderVersion={orderVersion} width={screenWidth} onPress={onFile} />}
        />
      </Animated.View>
    </View>
    </CollapsiblePartsProvider>
  );
};

/** The room under the newest message: the keyboard (or the bar's resting
 * spot), the bar as tall as it is this frame, its file chips, and a small gap.
 * On the UI thread, from the same values the bar lays out by. */
const BarSpace = (props: {
  readonly geometry: BarGeometry;
  readonly restingBottom: number;
  readonly chips: number;
}): React.ReactElement => {
  const keyboardHeight = useKeyboardHeightValue();
  const { geometry, restingBottom, chips } = props;
  const space = useAnimatedStyle(() => ({
    height: Math.max(keyboardHeight.value, restingBottom) + COMPOSER_BAR_HEIGHT + barExtra(geometry) + chips + BAR_SPACE_GAP,
  }));
  return <Animated.View style={space} />;
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  composerFloat: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    // `bottom` is set inline from keyboardHeight — see the element itself.
  },
  content: {
    // Vertical only. The horizontal gutter belongs to each row (see
    // MessageBubble, BusyRow, PermissionPrompt) so a row can opt out of it —
    // full-bleed code or tool output has nowhere to go if the scroll
    // container owns the inset.
    paddingVertical: 16,
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    paddingHorizontal: ROW_GUTTER,
    color: text.secondaryLabel,
    fontSize: 15,
    textAlign: "center",
    marginTop: 40,
  },
});
