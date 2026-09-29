/**
 * The chat/Home composer — the message-input variant of the bottom bar. It owns
 * the intricate, timing-sensitive state (focus → animate → collapse, growing
 * multiline input, model selection, send-and-clear) and composes {@link BottomBar}
 * for everything structural: the glass field, the squircle clip, the collapse
 * layout. Screens vary it through `placeholder`, `topSection` (Home's
 * repo/worktree/branch pickers), and `agentSurface`.
 *
 * It is the first of the bar's two pages, Dubz the second (Dubz.tsx): while
 * expanded, a swipe left slides it off and Dubz in beside it, both by layout
 * (margins here, `left` there), never a transform (glass dies under one). A tap
 * on the collapsed bar opens the page opened last. Where Dubz is off for the
 * surface, the composer is the only page. `DubzBar` is the bar where Dubz is the
 * only page: the same collapsed bar, opening Dubz.
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
 * `+`/send are real native SwiftUI `Button`s (background circle, glass effect
 * and SF Symbol one native element via `@expo/ui`). `glassEffect` is confirmed
 * load-bearing — swapping it for a flat `background()` reintroduced a delayed-
 * alignment bug (see `CHIP_BUTTON_MODIFIERS`). Attachment (`+`) is still a stub;
 * model selection is real (`client.provider.list()`), passed on every send.
 *
 * @internal
 */
import { Button, Host } from "@expo/ui/swift-ui";
import { buttonStyle, foregroundStyle, frame, glassEffect, imageScale, labelStyle } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { LayoutAnimation, StyleSheet, Text, TextInput, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { runOnJS, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useIsFocused } from "@react-navigation/native";
import { useAppContext } from "./AppContext";
import { AGENT_NAME, useAgentButtonVisible, type AgentSurface } from "./agentButtonSettings";
import { BottomBar } from "./BottomBar";
import { barPage, PAGE_FLING, PAGE_MS, PAGE_SLOP_X, PAGE_SLOP_Y, PAGE_TURN, pageEasing, rememberPage, useDubz } from "./Dubz";
import { colors } from "./colors";
import { useTheme } from "./theme";
import { COMPOSER_CHIP_SIZE, COMPOSER_SEND_CHIP_SIZE } from "./composerBarSpec";
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

// Colors mixed toward a neutral (not lowered alpha), staying on the confirmed-
// safe `glassEffect` with a fully opaque tint. `+` is gray mixed toward black.
const mixRgb = (
  base: readonly [number, number, number],
  target: readonly [number, number, number],
  factor: number,
  alpha = 1,
): string => {
  const [r, g, b] = base.map((channel, i) => Math.round(channel + (target[i] - channel) * factor));
  return alpha === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
};
const SYSTEM_GRAY = { light: [142, 142, 147], dark: [142, 142, 147] } as const;
const WHITE: readonly [number, number, number] = [255, 255, 255];
const BLACK: readonly [number, number, number] = [0, 0, 0];
const GRAY_LIGHTEN_FACTOR = 0.6;
const GRAY_DARKEN_FACTOR = 0.25;
const FILL_ALPHA = 0.85;
const CHIP_FILL = mixRgb(SYSTEM_GRAY.light, WHITE, GRAY_LIGHTEN_FACTOR, FILL_ALPHA);
const CHIP_ICON = mixRgb(SYSTEM_GRAY.light, BLACK, GRAY_DARKEN_FACTOR);

// +/send's background, glass effect and icon as one native element. Confirmed:
// swapping `glassEffect` for `background(color, shapes.circle())` reintroduced
// the delayed-alignment bug, so glass stays. `foregroundStyle` LAST, after
// `glassEffect` — order is significant; before it the glass overrode the glyph
// colour.
const CHIP_BUTTON_MODIFIERS = [
  buttonStyle("plain"),
  labelStyle("iconOnly"),
  imageScale("small"),
  frame({ width: COMPOSER_CHIP_SIZE, height: COMPOSER_CHIP_SIZE }),
  glassEffect({ glass: { variant: "regular", interactive: true, tint: CHIP_FILL }, shape: "circle" }),
  foregroundStyle(CHIP_ICON),
];

// Send has two states: solid green when there's text, muted green when not. The
// glyph stays white in both.
const sendButtonModifiers = (active: boolean, activeFill: string, mutedFill: string) => [
  buttonStyle("plain"),
  labelStyle("iconOnly"),
  imageScale("medium"),
  frame({ width: COMPOSER_SEND_CHIP_SIZE, height: COMPOSER_SEND_CHIP_SIZE }),
  glassEffect({ glass: { variant: "regular", interactive: true, tint: active ? activeFill : mutedFill }, shape: "circle" }),
  foregroundStyle("#FFFFFF"),
];

/** Each composer's id, so only the one on screen slides with the pages. */
let nextComposeId = 0;

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
  /** Which surface this composer is on — whether Dubz is its second page, per
   * the user's settings. */
  readonly agentSurface: AgentSurface;
}): React.ReactElement => {
  const { client } = useAppContext();
  const { colors: themeColors } = useTheme();
  const inputRef = React.useRef<TextInput>(null);
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [focused, setFocused] = React.useState(false);
  const [models, setModels] = React.useState<ReadonlyArray<ModelOption>>([]);
  const [selectedModel, setSelectedModel] = React.useState<ModelOption | undefined>(undefined);
  // Held open while it slides back in from Dubz, until its input takes focus.
  const [held, setHeld] = React.useState(false);
  const expanded = focused || held || text.length > 0;
  const dubz = useDubz();
  const { pageX, slidingCompose, barAway, prepare, unprepare, beginFromCompose, settleOnDubz, stayOnCompose, registerCompose } = dubz;
  const withDubz = useAgentButtonVisible(props.agentSurface);
  const isFocused = useIsFocused();
  const [id] = React.useState(() => {
    nextComposeId += 1;
    return nextComposeId;
  });
  const { width: screenW } = useWindowDimensions();
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
    LayoutAnimation.configureNext(EXPAND_ANIMATION);
    setFocused(true);
    setHeld(false);
    if (withDubz) rememberPage("compose");
  };

  const focusInput = React.useCallback(() => inputRef.current?.focus(), []);

  /** Open the bar to the page opened last. */
  const expand = (): void => {
    if (withDubz && barPage() === "dubz") dubz.open();
    else focusInput();
  };

  // On screen, with Dubz on, this composer is the page beside Dubz.
  React.useEffect(() => {
    if (!isFocused || !withDubz) return undefined;
    return registerCompose({
      id,
      hold: setHeld,
      focus: focusInput,
    });
  }, [isFocused, withDubz, id, registerCompose, focusInput]);

  // Expanded, with Dubz on: the Dubz window mounts beside it, off screen, so a
  // swipe finds it ready instead of waiting for it to mount mid-swipe.
  React.useEffect(() => {
    if (!expanded || !isFocused || !withDubz) return undefined;
    prepare(id);
    return () => unprepare(id);
  }, [expanded, isFocused, withDubz, id, prepare, unprepare]);

  // Swipe left, while expanded, to slide Dubz in. Only a clear sideways drag
  // pages, so typing, selecting and the controls are left alone.
  const toDubz = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(expanded && withDubz && isFocused)
        .activeOffsetX([-PAGE_SLOP_X, PAGE_SLOP_X])
        .failOffsetY([-PAGE_SLOP_Y, PAGE_SLOP_Y])
        .onStart(() => {
          runOnJS(beginFromCompose)(id);
        })
        .onUpdate((e) => {
          const moved = -e.translationX / screenW;
          pageX.value = moved < 0 ? 0 : moved > 1 ? 1 : moved;
        })
        .onEnd((e) => {
          const turned = pageX.value > PAGE_TURN || e.velocityX < -PAGE_FLING;
          runOnJS(turned ? settleOnDubz : stayOnCompose)();
          pageX.value = withTiming(turned ? 1 : 0, { duration: PAGE_MS, easing: pageEasing });
        }),
    [expanded, withDubz, isFocused, pageX, beginFromCompose, id, screenW, settleOnDubz, stayOnCompose],
  );

  // Off to the left by how far the pages stand from the composer; only this
  // composer, when it is the one sliding. Wholly off while Dubz stands in for
  // the bar.
  const slide = useAnimatedStyle(() => {
    const aside = barAway.value === 1 ? screenW : slidingCompose.value === id ? pageX.value * screenW : 0;
    return {
      marginLeft: -aside,
      marginRight: aside,
    };
  });

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
    <GestureDetector gesture={toDubz}>
      <Reanimated.View style={slide}>
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
            <Host style={styles.chipHost}>
              <Button
                label="Attach"
                systemImage="plus"
                onPress={() => {
                  // Collapsed: whole bar expands. Expanded: attach is still a stub.
                  if (!expanded) expand();
                }}
                modifiers={CHIP_BUTTON_MODIFIERS}
              />
            </Host>
          }
          expandedCenter={<ModelPicker models={models} selected={selectedModel} onChange={pickModel} />}
          collapsedCenter={
            <Text style={[styles.mirrorText, text.length === 0 && styles.mirrorPlaceholder]} numberOfLines={1}>
              {text.length > 0 ? text : props.placeholder}
            </Text>
          }
          trailing={
            <Host style={styles.sendChipHost}>
              <Button
                label="Send"
                systemImage="arrow.up"
                onPress={() => {
                  if (!expanded) {
                    expand();
                    return;
                  }
                  void send();
                }}
                modifiers={sendButtonModifiers(hasContent, themeColors.sendActiveFill, themeColors.sendMutedFill)}
              />
            </Host>
          }
        />
      </Reanimated.View>
    </GestureDetector>
  );
};

/**
 * The bar where Dubz is the only page (nothing to compose there, as in Files):
 * the composer's collapsed bar, the same to the pixel, and any tap on it opens
 * Dubz. Nothing where Dubz is off for the surface.
 */
export const DubzBar = (props: {
  /** Home-indicator safe-area inset. */
  readonly bottomInset: number;
  readonly agentSurface: AgentSurface;
}): React.ReactElement | null => {
  const { colors: themeColors } = useTheme();
  const dubz = useDubz();
  const { barAway } = dubz;
  const visible = useAgentButtonVisible(props.agentSurface);
  const { width: screenW } = useWindowDimensions();
  // Off screen while Dubz stands in for it, so it never shows through.
  const away = useAnimatedStyle(() => {
    const aside = barAway.value === 1 ? screenW : 0;
    return {
      marginLeft: -aside,
      marginRight: aside,
    };
  });
  if (!visible) return null;
  return (
    <Reanimated.View style={away}>
      <BottomBar
        expanded={false}
        bottomInset={props.bottomInset}
        onExpandRequest={dubz.open}
        input={null}
        leading={
          <Host style={styles.chipHost}>
            <Button label="Attach" systemImage="plus" onPress={dubz.open} modifiers={CHIP_BUTTON_MODIFIERS} />
          </Host>
        }
        expandedCenter={null}
        collapsedCenter={
          <Text style={[styles.mirrorText, styles.mirrorPlaceholder]} numberOfLines={1}>
            {`Ask ${AGENT_NAME}…`}
          </Text>
        }
        // Muted, as the composer's is with nothing to send.
        trailing={
          <Host style={styles.sendChipHost}>
            <Button label="Send" systemImage="arrow.up" onPress={dubz.open} modifiers={sendButtonModifiers(false, themeColors.sendActiveFill, themeColors.sendMutedFill)} />
          </Host>
        }
      />
    </Reanimated.View>
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
  chipHost: {
    width: COMPOSER_CHIP_SIZE,
    height: COMPOSER_CHIP_SIZE,
  },
  sendChipHost: {
    width: COMPOSER_SEND_CHIP_SIZE,
    height: COMPOSER_SEND_CHIP_SIZE,
  },
  mirrorText: {
    color: colors.label,
    fontSize: 16,
  },
  mirrorPlaceholder: {
    color: colors.placeholderText,
  },
});
