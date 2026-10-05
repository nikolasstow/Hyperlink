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
import { reloadMenuItems } from "./reload";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { DubzContext } from "./dubzSuggestions";
import * as React from "react";
import { ActionSheetIOS, Alert, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, Vibration, View } from "react-native";
import Animated, { scrollTo, useAnimatedProps, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useDerivedValue, useSharedValue } from "react-native-reanimated";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollViewMarker } from "react-native-screens/src/components/gamma/scroll-view-marker";
import { useAppContext } from "./AppContext";
import { chatMessageOfV1 } from "./chat/fromV1";
import { chatMessageOfQueued, pendingMessages, sameMessages } from "./chat/fromOutbox";
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
import { rememberConversation, retitleConversation, useKeptConversation } from "./conversations/useConversations";
import { cachedSessionTitle } from "./sessionCache";
import { interruptSession, sessionProtocol } from "./sessions/protocol";
import { AGENT } from "./client";
import { promptRenameSession } from "./sessionActions";
import { BUSY_ROW_GAP, BUSY_ROW_HEIGHT, BusyRow } from "./BusyRow";
import { startLiveActivity } from "../modules/live-activity";
import { CollapsiblePartsProvider } from "./CollapsibleParts";
import { ROW_GUTTER } from "./layout";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { MESSAGE_GAP, MessageBubble, RECEIPT_HEIGHT } from "./MessageBubble";
import { dateHeaders } from "./chat/dateHeaders";
import { latestReceipt } from "./chat/receipt";
import type { Arrival } from "./messageArrival";
import { PermissionPrompt } from "./PermissionPrompt";
import { setViewedSession } from "./push";
import { markSessionRead } from "./sessionReads";
import type { RootStackParamList } from "./RootNavigator";
import { barExtra, useBarGeometry } from "./barGeometry";
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
import { BackgroundOverride, type TextColors, useScreenBackground, useThemedStyles } from "./theme";
import { useSessionBackground } from "./sessions/useSessionBackground";
import { repoOfDirectory } from "./primaryWorktree";

type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

/** Dubz in a session: its suggestions pick a repo, for now. */
const SESSION_DUBZ: DubzContext = {
  surface: "session",
  scope: { kind: "all" },
};

const NO_MESSAGES: ReadonlyArray<ChatMessage> = [];

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
  const { transcript, loaded, pendingPermission, replyPermission, clearBusy, connected, refresh } = useSessionStream(client, sessionID, address, streamEnabled);

  const server = React.useMemo(() => serverAddressOf(address), [address]);
  const session = React.useMemo(() => SessionID.make(sessionID), [sessionID]);
  // What the device kept of the conversation (conversations/): the chat opens
  // on it, nothing to fetch, and shows it until its whole history is in.
  const kept = useKeptConversation(server, sessionID);
  // Its own background, when it has one (Session Settings).
  const background = useSessionBackground(sessionID);
  // Which API the session is spoken to over (sessions/protocol.ts): known
  // when the app just made it or kept it, found out otherwise.
  const [foundProtocol, setProtocol] = React.useState<Protocol | undefined>(props.route.params.protocol);
  const protocol = foundProtocol ?? kept?.protocol;
  // Being found out: a send made meanwhile waits for it.
  const finding = React.useRef<Promise<Protocol> | undefined>(undefined);
  React.useEffect(() => {
    if (protocol !== undefined) return undefined;
    let cancelled = false;
    const found = runApp(sessionProtocol(server, session));
    finding.current = found;
    void found.then((answer) => {
      if (!cancelled) setProtocol(answer);
    });
    return () => {
      cancelled = true;
    };
  }, [server, session, protocol]);

  // The conversation (what the server has), then what is still in the
  // outbox, until the server has it too (same id) and the
  // conversation shows it.
  const v2Messages = useV2Transcript(server, session, protocol === "v2" && streamEnabled);
  // The whole conversation, once in: undefined until then.
  const live = React.useMemo(
    (): ReadonlyArray<ChatMessage> | undefined =>
      protocol === "v2"
        ? v2Messages
        : protocol === "v1" && loaded
          ? transcript.order.flatMap((id) => {
              const message = transcript.messages.get(id);
              return message === undefined ? [] : [chatMessageOfV1(message)];
            })
          : undefined,
    [protocol, v2Messages, loaded, transcript],
  );
  const delivered = live ?? kept?.messages ?? NO_MESSAGES;
  // The newest of it kept as it changes, so the next open starts from here.
  React.useEffect(() => {
    if (live === undefined || protocol === undefined) return;
    rememberConversation(server, sessionID, protocol, live).catch((error: unknown) => console.error("[conversations] keeping the chat failed", error));
  }, [server, sessionID, protocol, live]);
  const lane = useLane(server, session);
  // After the conversation: what is queued, and what the server took that the
  // conversation does not show yet (fromOutbox.ts). Carried from render to
  // render, so a message never leaves the list between the two.
  const [pending, setPending] = React.useState<ReadonlyArray<ChatMessage>>([]);
  const nextPending = React.useMemo(
    () =>
      pendingMessages(
        pending,
        (lane?.messages ?? []).map(chatMessageOfQueued),
        new Set(delivered.map((message) => message.id)),
      ),
    [pending, lane, delivered],
  );
  if (!sameMessages(nextPending, pending)) setPending(nextPending);
  const messages = React.useMemo(
    (): ReadonlyArray<ChatMessage> => (nextPending.length === 0 ? delivered : [...delivered, ...nextPending]),
    [delivered, nextPending],
  );
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
  const listRef = useAnimatedRef<FlatList<string>>();
  const keyboardValue = useKeyboardHeightValue();
  // The room under the newest message, this frame: the keyboard (or the bar's
  // resting spot), the bar as tall as it is now, its file chips.
  const restingBottom = composerRestingBottom(insets.bottom);
  const chipsHeight = files.length > 0 ? FILE_CHIPS_HEIGHT : 0;
  // At rest (keyboard down, bar collapsed) that room is part of the list's
  // own layout, a spacer under the newest message, so a chat opens in place
  // from its first frame. What the keyboard and the open bar add is the
  // scroll view's inset, set every frame on the UI thread (an inset is no
  // layout; resizing the spacer every frame re-laid out the whole list).
  const restingRoom = restingBottom + COMPOSER_BAR_HEIGHT + chipsHeight;
  const listInset = useDerivedValue(() => Math.max(keyboardValue.value, restingBottom) - restingBottom + barExtra(barGeometry));
  // The list's scroll position (the newest message is at -listInset).
  const listOffset = useSharedValue(0);
  const onListScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      listOffset.value = event.contentOffset.y;
    },
  });
  // As the room changes, the messages move with it, wherever the list is
  // scrolled: what is in view stays in line with the bar and the keyboard.
  useAnimatedReaction(
    () => listInset.value,
    (inset, previous) => {
      if (previous === null || inset === previous) return;
      const offset = listOffset.value - (inset - previous);
      // Taken now: the scroll event that reports it comes a frame later.
      listOffset.value = offset;
      scrollTo(listRef, 0, offset, false);
    },
  );
  const listInsetProps = useAnimatedProps(() => ({
    contentInset: { top: listInset.value, left: 0, bottom: 0, right: 0 },
    scrollIndicatorInsets: { top: listInset.value, left: 0, bottom: 0, right: 0 },
  }));
  // Your message just sent, arriving from the input.
  const [arriving, setArriving] = React.useState<{ readonly id: string; readonly arrival: Arrival } | undefined>(undefined);
  // Keyboard up: select it for the message (or unselect). Down: open it.
  const onFile = (file: SessionFile): void => {
    if (keyboardHeight === 0) {
      // In its repo's Files, in a new tab (its navigation and tabs with it).
      const repoDir = directory ?? file.path.slice(0, file.path.lastIndexOf("/"));
      const repo = repoOfDirectory(repoDir) ?? repoDir.split("/").filter(Boolean).pop() ?? repoDir;
      props.navigation.navigate("Files", { repo, dir: repoDir, open: { path: file.path, name: file.name } });
      return;
    }
    setSelected((current) => (current.includes(file.path) ? current.filter((path) => path !== file.path) : [file.path, ...current]));
    setOrderVersion((version) => version + 1);
  };
  // Its title from the first frame: kept with the conversation, or from the
  // session list read this launch; renamed here, the new one.
  const [renamed, setRenamed] = React.useState<string | undefined>(undefined);
  const title = renamed ?? kept?.title ?? cachedSessionTitle(sessionID);
  // Newest-first — paired with `inverted` below, which should anchor the
  // list to the newest message on its own. In practice it wasn't sticking
  // reliably, so this still explicitly re-pins to `offset: 0` (an
  // inverted list's "start", i.e. its bottom) whenever a message is
  // appended — the same role the old `scrollToEnd` played pre-inversion.
  const reversedOrder = React.useMemo(() => messages.map((message) => message.id).reverse(), [messages]);
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
  // How far the reader is from the newest message, and taking them to it
  // (the newest sits at -listInset).
  const scrolledBack = React.useCallback((): number => listOffset.value + listInset.value, [listOffset, listInset]);
  const toNewest = React.useCallback(
    (animated: boolean): void => listRef.current?.scrollToOffset({ offset: -listInset.value, animated }),
    [listRef, listInset],
  );
  // A new message brings the list to it only when you sent it, or you were
  // already at the newest; reading back, you stay where you are.
  const newestID = reversedOrder[0];
  const shownNewest = React.useRef(newestID);
  React.useEffect(() => {
    if (newestID === undefined || newestID === shownNewest.current) return;
    shownNewest.current = newestID;
    const yours = byID.get(newestID)?.role === "user";
    if (yours || scrolledBack() < NEAR_NEWEST) toNewest(true);
  }, [newestID, byID, scrolledBack, toNewest]);

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

  // Rename via the shared action; apply the new title locally on success.
  const renameSession = React.useCallback(() => {
    promptRenameSession(client, sessionID, title ?? "", (next) => {
      setRenamed(next);
      retitleConversation(server, sessionID, next).catch((error: unknown) => console.error("[conversations] keeping the new title failed", error));
    });
  }, [client, server, sessionID, title]);

  // Title and connection state are screen state, so they reach the header
  // through setOptions rather than static screen options; before the first
  // frame is drawn (a layout effect), so the header never arrives late.
  React.useLayoutEffect(() => {
    props.navigation.setOptions({
      // The id while its name is not on the device (opened from a notification
      // before the session list is read, a subagent's session).
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
                icon: { type: "sfSymbol", name: "pencil" },
                onPress: () => renameSession(),
              },
              {
                type: "action",
                label: "Refresh",
                icon: { type: "sfSymbol", name: "arrow.clockwise" },
                onPress: () => refresh(),
              },
              {
                type: "action",
                label: "Settings",
                icon: { type: "sfSymbol", name: "gearshape" },
                onPress: () => props.navigation.navigate("SessionSettings", { sessionID }),
              },
              ...reloadMenuItems,
            ],
          },
        },
      ],
    });
  }, [props.navigation, title, sessionID, connected, refresh, renameSession]);

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
    const spoken = protocol ?? (await finding.current);
    if (spoken === undefined) throw new Error("The session's protocol is not known");
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
    // It flies from the input to its row at the bottom of the list: the list
    // goes to the newest first (from wherever it was), unless a permission
    // prompt sits below the newest message.
    const landed = new Promise<void>((resolve) => {
      if (pendingPermission !== undefined) {
        resolve();
        return;
      }
      toNewest(false);
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
      protocol: spoken,
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

  // Stable while the conversation is: the list re-renders a row only when
  // that row's own data changes, not whenever the screen does (the keyboard
  // showing re-rendered every row, a heavy native update as it rose).
  const renderItem = React.useCallback(
    ({ item }: { readonly item: string }): React.ReactElement | null => {
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
    },
    [pendingPermission, replyPermission, byID, onQueuedPress, arriving, receipt, headers],
  );

  // No `paddingBottom: keyboardHeight` on root — the composer is
  // absolutely positioned, and absolute children weren't being offset by
  // that padding (they sat behind the keyboard instead), so both the
  // composer and the list account for the keyboard explicitly below
  // rather than relying on padding-box positioning semantics.
  return (
    <BackgroundOverride light={background?.light} dark={background?.dark}>
    <CollapsiblePartsProvider newestID={newestCollapsibleID}>
    <View style={styles.root}>
      <ChatBackground />
      {/* Marks this list for iOS 26's scroll edge effect. Both edges are
        * set because the list is `inverted` (a scaleY(-1) transform), so
        * its native top edge is the visual bottom — targeting one edge
        * would mean guessing at that mapping. */}
      <ScrollViewMarker style={styles.flex} scrollEdgeEffects={{ top: "soft", bottom: "soft" }}>
      <Animated.FlatList
        ref={listRef}
        inverted
        // The room under the newest message is the scroll view's own inset,
        // following the bar and the keyboard frame by frame (listInset); an
        // inset is no layout, so nothing in the list is laid out again.
        animatedProps={listInsetProps}
        // Its follow-the-room scroll lands in the same frame as the room grows;
        // React Native would clamp it to the room as it was, short of the
        // newest message, without this.
        scrollToOverflowEnabled
        onScroll={onListScroll}
        scrollEventThrottle={16}
        // No automatic insets: the list is inverted, so iOS's header inset
        // (at the scroll view's native top) landed at the visual bottom, on top
        // of the bar's room, and "scroll to newest" (offset 0) stopped short of
        // it, leaving blank space below. The padding below is exact instead;
        // the scroll edge effect comes from ScrollViewMarker, as on Home.
        contentInsetAdjustmentBehavior="never"
        // The whole screen: messages pass behind the bar's glass.
        style={styles.flex}
        // With the keyboard up, a tap on the chat only closes it (the list
        // takes the touch, so no row gets it); a scroll keeps it up. React
        // Native's own handling: a touch that ends without scrolling blurs.
        keyboardShouldPersistTaps="never"
        keyboardDismissMode="none"
        data={listData}
        keyExtractor={(id) => id}
        renderItem={renderItem}
        ListEmptyComponent={<Text style={styles.empty}>Ask a question, or ask it to make a change.</Text>}
        // Below the newest message, not above the oldest — the header, not
        // the footer, is what renders nearest the (inverted) start of the
        // list, which an inverted list pins to the bottom of the screen.
        // Under the newest message: the busy row, then the bar's resting room.
        ListHeaderComponent={
          <>
            {busy ? <BusyRow onStop={onStop} startedAt={answerStartedAt(messages)} /> : null}
            <View style={{ height: restingRoom }} />
          </>
        }
        // `inverted` flips the whole content area as a unit, so these are
        // swapped from how they read: `paddingBottom` — normally "space
        // after the last item" — renders as reserved space at the screen's
        // visual TOP (under the header), and `paddingTop`
        // renders at the visual BOTTOM (a small gap above the bar).
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: topBarHeight + 16,
            paddingTop: BAR_SPACE_GAP,
          },
        ]}
      />
      </ScrollViewMarker>
      <EdgeBlurBars busy={busy} />
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
          // Send any time: a message waits in the outbox (v1) or on the server
          // (v2) until the agent is free.
          disabled={false}
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
    </BackgroundOverride>
  );
};

/** The chat's background: the session's own colour where it has one, else
 * the app's (BackgroundOverride above it). */
const ChatBackground = (): React.ReactElement => {
  const backgroundColor = useScreenBackground();
  return <View style={[StyleSheet.absoluteFill, { backgroundColor }]} pointerEvents="none" />;
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
