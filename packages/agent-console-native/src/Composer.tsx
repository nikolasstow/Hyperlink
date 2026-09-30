/**
 * The chat/Home composer — the message-input variant of the bottom bar. It owns
 * the intricate, timing-sensitive state (focus → animate → collapse, growing
 * multiline input, model selection, send-and-clear) and composes {@link BottomBar}
 * for everything structural: the glass field, the squircle clip, the collapse
 * layout. Screens vary it through `placeholder`, `topSection` (Home's
 * repo/worktree/branch pickers), and `dubzContext`.
 *
 * The bar has two pages side by side: this composer, then Dubz (Dubz.tsx).
 * Each is one component with a collapsed state (the bar; the two are the same
 * pill) and an expanded one, animated between, never swapped. Collapsed, the
 * bar shows the page opened last. Expanded, a swipe slides to the other page,
 * by layout (margins here, `left` on the Dubz page), never a transform (glass
 * dies under one); what the turn changes (focus, the page remembered) waits
 * until the slide has finished, so the JS side never competes with its frames.
 * Where Dubz is off for the surface, the composer is the only page.
 *
 * This is the "component that takes other components" split: the fragile glass
 * and collapse mechanics live once in `BottomBar` (see its header for the
 * invariants), and this file passes them the pieces that actually differ —
 * `input`, `leading` (+), `expandedCenter` (model picker), `collapsedCenter`
 * (the one-line mirror) and `trailing` (send). The shell never owns state; it
 * lays out what it's given and gates it by the single `expanded` flag this
 * computes. The animation stays this file's to trigger
 * (`LayoutAnimation.configureNext` in the focus/blur/send handlers); the layout
 * it animates lives in the shell.
 *
 * `+`/send are the bar's shared buttons (composerChips.tsx). Attachment (`+`)
 * is still a stub; model selection is real (`client.provider.list()`), passed
 * on every send.
 *
 * @internal
 */
import * as React from "react";
import { LayoutAnimation, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useAppContext } from "./AppContext";
import { useAgentButtonVisible } from "./agentButtonSettings";
import { BottomBar } from "./BottomBar";
import { PlusChip, SendChip } from "./composerChips";
import { DubzPage, PAGE_FLING, PAGE_MS, PAGE_SLOP_X, PAGE_SLOP_Y, PAGE_TURN, pageEasing, rememberPage, useBarPage, type PageBack } from "./Dubz";
import { colors } from "./colors";
import type { DubzContext } from "./dubzSuggestions";
import { findModel, getDefaultModel, listModels, type ModelOption } from "./models";
import { ModelPicker } from "./ModelPicker";
import { getLastModel, setLastModel } from "./settings";

// A fontSize:16 line needs roughly INPUT_LINE_HEIGHT of vertical room. iOS
// multiline TextInput can't render shorter than its content needs, so this is
// the real single-line minimum regardless of the row-visibility mechanism.
const INPUT_LINE_HEIGHT = 20;
const MIN_INPUT_HEIGHT = INPUT_LINE_HEIGHT + 16;
const MAX_INPUT_HEIGHT = 120;

// `'keyboard'` is UIKit's own keyboard-curve constant (not `easeInEaseOut`,
// which runs ~300ms and visibly lags the keyboard's ~250ms). 180ms trades exact
// sync for a snappier feel — deliberate; go back toward 250 if the desync reads
// worse than the speed is worth.
const EXPAND_ANIMATION = {
  duration: 180,
  create: { type: "keyboard", property: "opacity" },
  update: { type: "keyboard" },
  delete: { type: "keyboard", property: "opacity" },
} as const;

export const Composer = (props: {
  readonly onSend: (text: string, model: ModelOption | undefined) => Promise<void>;
  readonly disabled: boolean;
  /** Home-indicator safe-area inset — 0 when the keyboard covers it. */
  readonly bottomInset: number;
  readonly placeholder: string;
  /** Prefer this model when set (e.g. last assistant turn in a session). */
  readonly seedModel?: ModelOption;
  /** Rendered inside the bubble above the input — Home's pickers; chat omits it. */
  readonly topSection?: React.ReactNode;
  /** Where this bar is: whether Dubz is its second page (per the user's
   * settings, by surface), and what Dubz suggests there. */
  readonly dubzContext: DubzContext;
}): React.ReactElement => {
  const { client } = useAppContext();
  const inputRef = React.useRef<TextInput>(null);
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [focused, setFocused] = React.useState(false);
  const [models, setModels] = React.useState<ReadonlyArray<ModelOption>>([]);
  const [selectedModel, setSelectedModel] = React.useState<ModelOption | undefined>(undefined);
  // Held expanded while it is a page sliding (away to Dubz, or back), when its
  // input is not the focused one.
  const [held, setHeld] = React.useState(false);
  const expanded = focused || held || text.length > 0;
  const withDubz = useAgentButtonVisible(props.dubzContext.surface);
  const lastPage = useBarPage();
  const [dubzOpen, setDubzOpen] = React.useState(false);
  // Open or collapse Dubz without its grow: it slid in, or away.
  const [dubzInstant, setDubzInstant] = React.useState(false);
  const dubzInputRef = React.useRef<TextInput>(null);
  const { width: screenW } = useWindowDimensions();
  // Where the pages stand: 0 this composer, 1 Dubz.
  const pageX = useSharedValue(withDubz && lastPage === "dubz" ? 1 : 0);
  const hasContent = text.trim().length > 0 && !props.disabled;
  // iOS multiline TextInput's intrinsic-size reporting doesn't reliably account
  // for its own padding; measure the content height directly instead.
  const [contentHeight, setContentHeight] = React.useState(MIN_INPUT_HEIGHT);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [options, last] = await Promise.all([listModels(client), getLastModel()]);
      if (cancelled) return;
      setModels(options);
      const fromSeed =
        props.seedModel !== undefined
          ? findModel(options, props.seedModel.providerID, props.seedModel.modelID) ?? props.seedModel
          : undefined;
      const fromLast = last !== undefined ? findModel(options, last.providerID, last.modelID) : undefined;
      setSelectedModel(fromSeed ?? fromLast ?? getDefaultModel(client) ?? options[0]);
    })();
    return () => {
      cancelled = true;
    };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps -- seed applied in the effect below

  React.useEffect(() => {
    if (props.seedModel === undefined || models.length === 0) return;
    const match = findModel(models, props.seedModel.providerID, props.seedModel.modelID);
    setSelectedModel(match ?? props.seedModel);
  }, [props.seedModel?.providerID, props.seedModel?.modelID, models]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickModel = (model: ModelOption): void => {
    setSelectedModel(model);
    void setLastModel({ providerID: model.providerID, modelID: model.modelID });
  };

  // onContentSizeChange fires once on mount with an unreliable measurement,
  // before any typing; ignoring it entirely while empty is the invariant that
  // matters — an empty field has no real content height to latch onto.
  const onContentSizeChange = (height: number): void => {
    if (text.length === 0) return;
    LayoutAnimation.configureNext(EXPAND_ANIMATION);
    setContentHeight(height);
  };

  const onFocus = (): void => {
    // Held (sliding in from Dubz), it is expanded already.
    if (!held) LayoutAnimation.configureNext(EXPAND_ANIMATION);
    setFocused(true);
    setHeld(false);
    if (withDubz) rememberPage("compose");
  };

  const expand = React.useCallback(() => inputRef.current?.focus(), []);

  // Collapsed, the bar shows the page opened last (on any screen).
  React.useEffect(() => {
    if (expanded || dubzOpen) return;
    pageX.value = withDubz && lastPage === "dubz" ? 1 : 0;
  }, [expanded, dubzOpen, withDubz, lastPage, pageX]);

  // ── To Dubz ──
  // The swipe begins: Dubz opens beside this, off to the right, already open.
  const beginToDubz = React.useCallback(() => {
    setHeld(true);
    setDubzInstant(true);
    setDubzOpen(true);
  }, []);
  // The slide has finished on Dubz: it takes the keyboard.
  const turnToDubz = React.useCallback(() => {
    rememberPage("dubz");
    dubzInputRef.current?.focus();
  }, []);
  // The slide has fallen back: Dubz goes, unseen.
  const stayOnCompose = React.useCallback(() => {
    setDubzOpen(false);
    setHeld(false);
  }, []);

  // ── Back from Dubz ──
  const pageBack = React.useMemo<PageBack>(
    () => ({
      pageX,
      begin: () => setHeld(true),
      turn: () => {
        rememberPage("compose");
        inputRef.current?.focus();
        setDubzInstant(true);
        setDubzOpen(false);
      },
      stay: () => setHeld(false),
    }),
    [pageX],
  );

  // Dubz, collapsed on the bar, tapped; and Dubz collapsing into the bar.
  const openDubz = React.useCallback(() => {
    rememberPage("dubz");
    setDubzInstant(false);
    setDubzOpen(true);
  }, []);
  const closeDubz = React.useCallback(() => {
    setDubzInstant(false);
    setDubzOpen(false);
    setHeld(false);
  }, []);

  // Swipe left, while expanded, to slide Dubz in. Only a clear sideways drag
  // pages, so typing, selecting and the controls are left alone.
  const toDubz = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(expanded && withDubz)
        .activeOffsetX([-PAGE_SLOP_X, PAGE_SLOP_X])
        .failOffsetY([-PAGE_SLOP_Y, PAGE_SLOP_Y])
        .onStart(() => {
          runOnJS(beginToDubz)();
        })
        .onUpdate((e) => {
          const moved = -e.translationX / screenW;
          pageX.value = moved < 0 ? 0 : moved > 1 ? 1 : moved;
        })
        .onEnd((e) => {
          const turned = pageX.value > PAGE_TURN || e.velocityX < -PAGE_FLING;
          pageX.value = withTiming(turned ? 1 : 0, { duration: PAGE_MS, easing: pageEasing }, (finished) => {
            if (finished === true) runOnJS(turned ? turnToDubz : stayOnCompose)();
          });
        }),
    [expanded, withDubz, pageX, screenW, beginToDubz, turnToDubz, stayOnCompose],
  );

  // Each page off to its side by how far the pages stand from it.
  const composeSlide = useAnimatedStyle(() => ({
    marginLeft: -pageX.value * screenW,
    marginRight: pageX.value * screenW,
  }));
  const dubzSlide = useAnimatedStyle(() => ({
    left: (1 - pageX.value) * screenW,
    right: -(1 - pageX.value) * screenW,
  }));

  const onBlur = (): void => {
    // Only animate the collapse when it will actually happen — typed text, or
    // being held as a page, keeps `expanded` true across a blur, so there's no
    // layout change to animate then.
    if (text.length === 0 && !held) LayoutAnimation.configureNext(EXPAND_ANIMATION);
    setFocused(false);
  };

  const send = async (): Promise<void> => {
    const value = text.trim();
    if (value.length === 0 || props.disabled) return;
    LayoutAnimation.configureNext(EXPAND_ANIMATION);
    setText("");
    setContentHeight(MIN_INPUT_HEIGHT);
    setError(undefined);
    try {
      await props.onSend(value, selectedModel);
    } catch {
      setError("Message failed to send — is the OpenCode server running?");
    }
  };

  return (
    <View style={styles.pages} pointerEvents="box-none">
      <GestureDetector gesture={toDubz}>
        <Reanimated.View style={composeSlide}>
          <BottomBar
            expanded={expanded}
            bottomInset={props.bottomInset}
            error={error}
            topSection={props.topSection}
            onExpandRequest={expand}
            input={
              <TextInput
                ref={inputRef}
                style={[
                  styles.input,
                  // Ignore `contentHeight` while empty — belt and suspenders with
                  // onContentSizeChange's own guard, so the field always shrinks back
                  // after a send.
                  { height: text.length === 0 ? MIN_INPUT_HEIGHT : Math.min(Math.max(contentHeight, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT) },
                ]}
                value={text}
                onChangeText={setText}
                onContentSizeChange={(e) => onContentSizeChange(e.nativeEvent.contentSize.height)}
                editable={!props.disabled}
                placeholder={props.placeholder}
                placeholderTextColor={colors.placeholderText}
                multiline
                submitBehavior="blurAndSubmit"
                onSubmitEditing={() => void send()}
                onFocus={onFocus}
                onBlur={onBlur}
              />
            }
            leading={
              <PlusChip
                onPress={() => {
                  // Collapsed: whole bar expands. Expanded: attach is still a stub.
                  if (!expanded) expand();
                }}
              />
            }
            expandedCenter={<ModelPicker models={models} selected={selectedModel} onChange={pickModel} />}
            collapsedCenter={
              <Text style={[styles.mirrorText, text.length === 0 && styles.mirrorPlaceholder]} numberOfLines={1}>
                {text.length > 0 ? text : props.placeholder}
              </Text>
            }
            trailing={
              <SendChip
                active={hasContent}
                onPress={() => {
                  if (!expanded) {
                    expand();
                    return;
                  }
                  void send();
                }}
              />
            }
          />
        </Reanimated.View>
      </GestureDetector>
      {withDubz ? (
        <Reanimated.View style={[styles.dubzPage, dubzSlide]} pointerEvents="box-none">
          <DubzPage open={dubzOpen} instant={dubzInstant} onOpen={openDubz} onClose={closeDubz} inputRef={dubzInputRef} context={props.dubzContext} pageBack={pageBack} />
        </Reanimated.View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  input: {
    // No explicit width — the shell's inputSection stretches it to full width.
    color: colors.label,
    fontSize: 16,
    // Explicit, computed against MIN_INPUT_HEIGHT so the two can't drift.
    lineHeight: INPUT_LINE_HEIGHT,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  // The Dubz page lies over the composer's bar, bottom to bottom, beside it
  // (`left` from dubzSlide).
  // Fills the screen's bar container (its top down to the keyboard); the
  // composer's bar sits at its bottom.
  pages: {
    flex: 1,
    justifyContent: "flex-end",
  },
  // The Dubz page fills it too, so its window grows inside its parents'
  // bounds (touches outside a parent never reach a view); beside the composer
  // (`left` from dubzSlide).
  dubzPage: {
    position: "absolute",
    top: 0,
    bottom: 0,
  },
  mirrorText: {
    color: colors.label,
    fontSize: 16,
  },
  mirrorPlaceholder: {
    color: colors.placeholderText,
  },
});
