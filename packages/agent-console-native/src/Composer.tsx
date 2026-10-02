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
 * computes. This file animates the bar's geometry (barGeometry.ts) to follow
 * `expanded` and the input's content; the shell lays out by it, and a screen
 * can pass its own to reserve the same room in the same frame.
 *
 * `+`/send are the bar's shared buttons (composerChips.tsx). Attachment (`+`)
 * is still a stub; model selection is real (`client.provider.list()`), passed
 * on every send.
 *
 * @internal
 */
import * as React from "react";
import { StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useAppContext } from "./AppContext";
import { useAgentButtonVisible } from "./agentButtonSettings";
import { type BarGeometry, INPUT_LINE_HEIGHT, INPUT_PADDING_VERTICAL, MAX_INPUT_HEIGHT, MIN_INPUT_HEIGHT, setBarOpen, setInputHeight, useBarGeometry } from "./barGeometry";
import { type BarTopSection, BottomBar } from "./BottomBar";
import { PlusChip, SendChip } from "./composerChips";
import { DubzPage, PAGE_FLING, PAGE_MS, PAGE_SLOP_X, PAGE_SLOP_Y, PAGE_TURN, pageEasing, rememberPage, useBarPage, type PageBack } from "./Dubz";
import type { DubzContext } from "./dubzSuggestions";
import { findModel, getDefaultModel, type ModelOption, refreshModels, reloadModels, useModels } from "./models";
import { ModelPicker, ModelWindow } from "./ModelPicker";
import type { CloseReason } from "./BarWindow";
import { recordModelUse } from "./modelUsage";
import { getLastModel, setLastModel } from "./settings";
import { type TextColors, useTextColors, useThemedStyles } from "./theme";

const noop = (): void => undefined;

export const Composer = (props: {
  readonly onSend: (text: string, model: ModelOption | undefined) => Promise<void>;
  readonly disabled: boolean;
  /** Where the message will run: the models offered are this directory's
   * (undefined until it is known). */
  readonly directory: string | undefined;
  /** Home-indicator safe-area inset — 0 when the keyboard covers it. */
  readonly bottomInset: number;
  readonly placeholder: string;
  /** Prefer this model when set (e.g. last assistant turn in a session). */
  readonly seedModel?: ModelOption;
  /** Rendered inside the bubble above the input, at a set height — Home's
   * pickers; chat omits it. */
  readonly topSection?: BarTopSection;
  /** Where this bar is: whether Dubz is its second page (per the user's
   * settings, by surface), and what Dubz suggests there. */
  readonly dubzContext: DubzContext;
  /** Above the bar, on its page, staying on top of it as it expands (the
   * chat's file chips). */
  readonly accessory?: React.ReactNode;
  /** The bar's geometry, when a screen reserves room for the bar by it (the
   * chat's list); the composer drives it. */
  readonly geometry?: BarGeometry;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { client, address } = useAppContext();
  const inputRef = React.useRef<TextInput>(null);
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [focused, setFocused] = React.useState(false);
  const models = useModels(client, props.directory);
  const [selectedModel, setSelectedModel] = React.useState<ModelOption | undefined>(undefined);
  // Held expanded while it is a page sliding (away to Dubz, or back), when its
  // input is not the focused one.
  const [held, setHeld] = React.useState(false);
  // The model window open over the bar (the bar stays expanded under it).
  const [modelsOpen, setModelsOpen] = React.useState(false);
  const expanded = focused || held || modelsOpen || text.length > 0;
  const pageType = props.dubzContext.surface;
  const withDubz = useAgentButtonVisible(pageType);
  const lastPage = useBarPage(pageType);
  const [dubzOpen, setDubzOpen] = React.useState(false);
  // Open or collapse Dubz without its grow: it slid in, or away.
  const [dubzInstant, setDubzInstant] = React.useState(false);
  const dubzInputRef = React.useRef<TextInput>(null);
  const { width: screenW } = useWindowDimensions();
  // Where the pages stand: 0 this composer, 1 Dubz.
  const pageX = useSharedValue(withDubz && lastPage === "dubz" ? 1 : 0);
  const hasContent = text.trim().length > 0 && !props.disabled;
  const ownGeometry = useBarGeometry();
  const geometry = props.geometry ?? ownGeometry;
  // The bar opens and closes with `expanded`, on the UI thread.
  React.useEffect(() => {
    setBarOpen(geometry, expanded);
  }, [geometry, expanded]);
  React.useEffect(() => {
    geometry.error.value = error !== undefined ? 1 : 0;
  }, [geometry, error]);

  // The model last sent with, once read; picked from the models once they load.
  const [lastModel, setLastModelRead] = React.useState<{ providerID: string; modelID: string } | undefined | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void getLastModel().then((last) => {
      if (!cancelled) setLastModelRead(last);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  React.useEffect(() => {
    if (selectedModel !== undefined || models.length === 0 || lastModel === null) return;
    const fromSeed =
      props.seedModel !== undefined
        ? findModel(models, props.seedModel.providerID, props.seedModel.modelID) ?? props.seedModel
        : undefined;
    const fromLast = lastModel !== undefined ? findModel(models, lastModel.providerID, lastModel.modelID) : undefined;
    setSelectedModel(fromSeed ?? fromLast ?? getDefaultModel(client, props.directory) ?? models[0]);
  }, [models, lastModel]); // eslint-disable-line react-hooks/exhaustive-deps -- seed applied in the effect below

  React.useEffect(() => {
    if (props.seedModel === undefined || models.length === 0) return;
    const match = findModel(models, props.seedModel.providerID, props.seedModel.modelID);
    setSelectedModel(match ?? props.seedModel);
  }, [props.seedModel?.providerID, props.seedModel?.modelID, models]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whether the message had the keyboard when the model window opened: leaving
  // the window puts it back as it was.
  const refocusAfterModels = React.useRef(false);
  const openModels = (): void => {
    refocusAfterModels.current = inputRef.current?.isFocused() === true;
    void refreshModels(client, props.directory);
    setModelsOpen(true);
  };
  const closeModels = React.useCallback((reason: CloseReason): void => {
    // Focus moves straight from the search to the message, so the keyboard
    // stays up; unless it went down (that closed the window).
    if (refocusAfterModels.current && reason !== "keyboard") {
      inputRef.current?.focus();
      // Focused already as far as the bar goes, so it stays expanded until the
      // input says so, never collapsing between.
      setFocused(true);
    }
    setModelsOpen(false);
  }, []);

  const pickModel = React.useCallback((model: ModelOption): void => {
    setSelectedModel(model);
    void setLastModel({ providerID: model.providerID, modelID: model.modelID });
  }, []);
  // Stable, so the (memoized) model window never re-renders with the bar.
  const chooseModel = React.useCallback(
    (model: ModelOption): void => {
      pickModel(model);
      closeModels("dismiss");
    },
    [pickModel, closeModels],
  );
  const directory = props.directory;
  const refreshCatalog = React.useCallback(() => reloadModels(client, address, directory), [client, address, directory]);

  // The input sizes itself to its text (one line to MAX_INPUT_HEIGHT, then it
  // scrolls); its section follows, animated, by the height Yoga gave it. Not
  // `onContentSizeChange`: on iOS's new architecture it fires once, empty,
  // and never as lines are added.
  const onInputLayout = (height: number): void => {
    setInputHeight(geometry, height);
  };

  const onFocus = (): void => {
    setFocused(true);
    setHeld(false);
    if (withDubz) rememberPage(pageType, "compose");
  };

  const expand = React.useCallback(() => inputRef.current?.focus(), []);


  // Collapsed, the bar shows this page type's page.
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
    rememberPage(pageType, "dubz");
    dubzInputRef.current?.focus();
  }, [pageType]);
  // The slide has fallen back: Dubz goes, unseen.
  const stayOnCompose = React.useCallback(() => {
    setDubzOpen(false);
    setHeld(false);
  }, []);

  // Collapsed, a swipe just slides between the bars; turned, the page is
  // this page type's from now on.
  const turnCollapsedToDubz = React.useCallback(() => rememberPage(pageType, "dubz"), [pageType]);

  // ── Back from Dubz ── (open: to the composer, expanded; collapsed: to its bar)
  const pageBack = React.useMemo<PageBack>(
    () => ({
      pageX,
      begin: (open) => {
        if (open) setHeld(true);
      },
      turn: (open) => {
        rememberPage(pageType, "compose");
        if (!open) return;
        inputRef.current?.focus();
        setDubzInstant(true);
        setDubzOpen(false);
      },
      stay: (open) => {
        if (open) setHeld(false);
      },
    }),
    [pageX, pageType],
  );

  // Dubz, collapsed on the bar, tapped; and Dubz collapsing into the bar.
  const openDubz = React.useCallback(() => {
    rememberPage(pageType, "dubz");
    setDubzInstant(false);
    setDubzOpen(true);
  }, [pageType]);
  const closeDubz = React.useCallback(() => {
    setDubzInstant(false);
    setDubzOpen(false);
    setHeld(false);
  }, []);

  // Swipe left to slide Dubz in: expanded, Dubz arrives open; collapsed, its
  // bar slides in. Only a clear sideways drag pages, so typing, selecting and
  // the controls are left alone.
  const toDubz = React.useMemo(() => {
    const begin = expanded ? beginToDubz : noop;
    const turn = expanded ? turnToDubz : turnCollapsedToDubz;
    const stay = expanded ? stayOnCompose : noop;
    return Gesture.Pan()
      .enabled(withDubz)
      .activeOffsetX([-PAGE_SLOP_X, PAGE_SLOP_X])
      .failOffsetY([-PAGE_SLOP_Y, PAGE_SLOP_Y])
      .onStart(() => {
        runOnJS(begin)();
      })
      .onUpdate((e) => {
        const moved = -e.translationX / screenW;
        pageX.value = moved < 0 ? 0 : moved > 1 ? 1 : moved;
      })
      .onEnd((e) => {
        const turned = pageX.value > PAGE_TURN || e.velocityX < -PAGE_FLING;
        pageX.value = withTiming(turned ? 1 : 0, { duration: PAGE_MS, easing: pageEasing }, (finished) => {
          if (finished === true) runOnJS(turned ? turn : stay)();
        });
      });
  }, [expanded, withDubz, pageX, screenW, beginToDubz, turnToDubz, turnCollapsedToDubz, stayOnCompose]);

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
    setFocused(false);
  };

  // One send at a time: the text stays until it is on its way.
  const sending = React.useRef(false);
  const send = async (): Promise<void> => {
    const value = text.trim();
    if (value.length === 0 || props.disabled || sending.current) return;
    sending.current = true;
    setError(undefined);
    try {
      // Cleared once it is on its way: the chat's bubble starts where the
      // text is, so the two swap in place.
      await props.onSend(value, selectedModel);
      setText("");
      if (selectedModel !== undefined) void recordModelUse(selectedModel);
    } catch {
      setError("Message failed to send — is the OpenCode server running?");
    } finally {
      sending.current = false;
    }
  };

  return (
    <View style={styles.pages} pointerEvents="box-none">
      <GestureDetector gesture={toDubz}>
        <Reanimated.View style={composeSlide}>
          {props.accessory}
          <BottomBar
            expanded={expanded}
            geometry={geometry}
            bottomInset={props.bottomInset}
            error={error}
            topSection={props.topSection}
            onExpandRequest={expand}
            input={
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={text}
                onChangeText={setText}
                onLayout={(e) => onInputLayout(e.nativeEvent.layout.height)}
                editable={!props.disabled}
                placeholder={props.placeholder}
                placeholderTextColor={textColors.placeholderText}
                multiline
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
            expandedCenter={<ModelPicker models={models} selected={selectedModel} onPress={openModels} />}
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
      <View style={styles.modelLayer} pointerEvents="box-none">
        <ModelWindow
          open={modelsOpen}
          models={models}
          selected={selectedModel}
          onChoose={chooseModel}
          onClose={closeModels}
          onRefresh={refreshCatalog}
        />
      </View>
      {withDubz ? (
        <Reanimated.View style={[styles.dubzPage, dubzSlide]} pointerEvents="box-none">
          <DubzPage open={dubzOpen} instant={dubzInstant} onOpen={openDubz} onClose={closeDubz} inputRef={dubzInputRef} context={props.dubzContext} pageBack={pageBack} />
        </Reanimated.View>
      ) : null}
    </View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
  input: {
    // No explicit width — the shell's inputSection stretches it to full width.
    color: text.label,
    fontSize: 16,
    // Explicit, computed against MIN_INPUT_HEIGHT so the two can't drift.
    lineHeight: INPUT_LINE_HEIGHT,
    paddingHorizontal: 4,
    paddingVertical: INPUT_PADDING_VERTICAL,
    minHeight: MIN_INPUT_HEIGHT,
    maxHeight: MAX_INPUT_HEIGHT,
    // Out of the flow, at the top of its section: an in-flow child of the
    // section (a set height, clipping) is measured no taller than it, so the
    // input could never grow past the section, nor the section past the
    // input. Positioned, it is measured on its text alone.
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
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
  // The model window's layer: over the composer's page, filling the bar's
  // container, so the window grows up inside its parents' bounds.
  modelLayer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  mirrorText: {
    color: text.label,
    fontSize: 16,
  },
  mirrorPlaceholder: {
    color: text.placeholderText,
  },
});
