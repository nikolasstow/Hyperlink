/**
 * The composer's model: its name in the bar, and on a tap the model window, a
 * BarWindow (grown up out of the bar, riding the keyboard as the bar does,
 * regular glass). Its pill is the search, focused as it opens; above it the
 * pages' tabs (Recents, then each provider, the most used first); above those
 * the page's models. Swipe between pages or tap a tab; typing swaps the pages
 * for every model matching. Pull a list down to have the server fetch the
 * models.dev catalog now. The window reads the models store live, so a
 * refresh landing while it is open shows at once.
 *
 * Label is the model name (or “Model” while loading); not “Auto” (Cursor’s
 * routing feature, which we don’t replicate). Provider titles are the server’s
 * `name` as-is, no client-side title-casing.
 *
 * @internal
 */
import { Feather } from "@expo/vector-icons";
import { Divider, Host, HStack, Image, LazyVStack, ScrollView, Spacer, TabView, Text, VStack } from "@expo/ui/swift-ui";
import {
  Animation,
  animation,
  background,
  clipped,
  contentShape,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  lineLimit,
  onTapGesture,
  padding,
  refreshable,
  useScrollGeometryChange,
  scrollDismissesKeyboard,
  scrollIndicators,
  shapes,
  tabViewStyle,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet, TextInput, View } from "react-native";
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { CapsuleTabs } from "../modules/capsule-tabs";
import { BarWindow, type CloseReason, detentMemory, HANDLE_CLEARANCE } from "./BarWindow";
import { CARD_RADIUS } from "./CardGlass";
import { COMPOSER_CHIP_SIZE, COMPOSER_SEND_CHIP_SIZE } from "./composerBarSpec";
import { modelKey, type ModelOption } from "./models";
import { type ModelUsage, useModelUsage } from "./modelUsage";
import { type TextColors, useCardTint, useTextColors, useTheme, useThemedStyles } from "./theme";

const RECENTS = "recents";
const RECENTS_LIMIT = 8;
const LABEL_MAX_WIDTH = 220;
/** The list's side margin, for the tabs and the list alike. */
const SIDE = 16;
/** The tabs' row: a tab and its 10pt above and below. */
const TABS_ROW = 28 + 20;
/** The floating search pill's space at the window's bottom: the pill (its row
 * and 7pt above and below) and its 12pt inset. */
const PILL_AREA = COMPOSER_SEND_CHIP_SIZE + 7 * 2 + 12;
/** Space under a list's last row, so it scrolls clear of the tabs and search. */
const UNDER_BARS = PILL_AREA + TABS_ROW + 8;
/** How far the tabs and search slide down to hide: past the window's bottom
 * (and the screen's, with the keyboard down). */
const BARS_HIDE = 150;
const BARS_MS = 220;
/** A scroll step larger than this is a different list (another page). */
const SCROLL_JUMP = 120;
/** The search list's inset inside its card, so a highlight rounds inside it. */
const PICK_INSET = 4;
const TAB_HEIGHT = 28;
const TAB_TITLE_MAX_WIDTH = 200;
const TAB_SPRING = Animation.spring({ duration: 0.3, bounce: 0.15 });
/** The search's one line, sized so the pill is the bar's height. */
const SEARCH_LINE_HEIGHT = 21;

/** The model window's one stop below full: its height, in points (about a
 * third of the screen). */
const MODEL_STOP = 300;
/** Where the model window opens (the stop, unless a drag left it at full),
 * for the app's run. */
const modelDetent = detentMemory(1);

/** One page of the list. */
interface ModelTab {
  readonly id: string;
  readonly title: string;
  /** Recents' clock: shown alone, its title only while it is the page open. */
  readonly icon?: "clock";
  readonly models: ReadonlyArray<ModelOption>;
  /** Rows name their provider (Recents mixes them). */
  readonly showProvider: boolean;
}

// Numbers by value, so a version 10 follows 9.
const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Recents, then each provider, the most sent with first (ties A to Z). */
const tabsOf = (models: ReadonlyArray<ModelOption>, usage: ModelUsage): ReadonlyArray<ModelTab> => {
  const providers = new Map<string, { title: string; models: Array<ModelOption>; uses: number }>();
  for (const model of models) {
    const uses = usage.get(modelKey(model))?.count ?? 0;
    const provider = providers.get(model.providerID);
    if (provider === undefined) {
      providers.set(model.providerID, {
        title: model.providerName,
        models: [model],
        uses,
      });
    } else {
      provider.models.push(model);
      provider.uses += uses;
    }
  }
  const providerTabs = Array.from(providers.entries())
    .sort(([, a], [, b]) => b.uses - a.uses || byName(a.title, b.title))
    .map(([providerID, provider]) => ({
      id: `provider:${providerID}`,
      title: provider.title,
      models: [...provider.models].sort((a, b) => byName(a.name, b.name)),
      showProvider: false,
    }));
  const recents = models
    .flatMap((model) => {
      const use = usage.get(modelKey(model));
      return use === undefined ? [] : [{ model, lastUsed: use.lastUsed }];
    })
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, RECENTS_LIMIT)
    .map((recent) => recent.model);
  return [
    {
      id: RECENTS,
      title: "Recents",
      icon: "clock",
      models: recents,
      showProvider: true,
    },
    ...providerTabs,
  ];
};

/** Every model whose name, id or provider holds each word of `query`, A to Z. */
const matching = (models: ReadonlyArray<ModelOption>, query: string): ReadonlyArray<ModelOption> => {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  return models
    .filter((model) => {
      const haystack = `${model.name} ${model.modelID} ${model.providerName}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort((a, b) => byName(a.name, b.name) || byName(a.providerName, b.providerName));
};

/** The model's name in the bar; a tap opens the model window. */
export const ModelPicker = (props: {
  readonly models: ReadonlyArray<ModelOption>;
  readonly selected: ModelOption | undefined;
  readonly onPress: () => void;
}): React.ReactElement => {
  const textColors = useTextColors();
  const label = props.selected?.name ?? (props.models.length === 0 ? "Model…" : "Model");
  return (
    // A set box (the label's widest), the label at its leading edge: SwiftUI
    // never sizes the box after it renders.
    <Host style={styles.host} ignoreSafeArea="all">
      <HStack
        spacing={4}
        modifiers={[
          padding({ trailing: 4 }),
          contentShape(shapes.rectangle()),
          onTapGesture(props.onPress),
          frame({ maxWidth: LABEL_MAX_WIDTH, height: COMPOSER_CHIP_SIZE, alignment: "leading" }),
        ]}
      >
        <Text modifiers={[font({ size: 13, weight: "medium" }), foregroundStyle(textColors.secondaryLabel), lineLimit(1), truncationMode("middle")]}>
          {label}
        </Text>
        <Image systemName="chevron.down" size={11} color={textColors.secondaryLabel} />
      </HStack>
    </Host>
  );
};

/** The model window: search in its pill, the pages above. Memoized: its
 * composer re-renders on every keystroke and streamed update, and none of that
 * concerns it. */
export const ModelWindow = React.memo(function ModelWindow(props: {
  readonly open: boolean;
  readonly models: ReadonlyArray<ModelOption>;
  readonly selected: ModelOption | undefined;
  readonly onChoose: (model: ModelOption) => void;
  readonly onClose: (reason: CloseReason) => void;
  /** Pulled to refresh: the server fetches the catalog now, then the list reloads. */
  readonly onRefresh: () => Promise<void>;
}): React.ReactElement {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { colors: themeColors } = useTheme();
  const cardTint = useCardTint();
  const usage = useModelUsage();
  const inputRef = React.useRef<TextInput>(null);
  const [tab, setTab] = React.useState(RECENTS);
  const [query, setQuery] = React.useState("");
  const [refreshError, setRefreshError] = React.useState<string | undefined>(undefined);
  const tabs = React.useMemo(() => tabsOf(props.models, usage), [props.models, usage]);
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? RECENTS;
  const selectedKey = props.selected !== undefined ? modelKey(props.selected) : undefined;
  const results = React.useMemo(() => matching(props.models, query), [props.models, query]);
  const searching = query.trim().length > 0;

  // The list exists only while the window is in sight: from opening until its
  // collapse has finished. Built on every screen's composer ahead of time, and
  // re-rendered with it, its hundred-odd native rows slowed the whole app.
  const [live, setLive] = React.useState(false);
  React.useEffect(() => {
    if (props.open) setLive(true);
  }, [props.open]);
  const onHidden = React.useCallback(() => setLive(false), []);

  // Each opening starts from an empty search.
  React.useEffect(() => {
    if (!props.open) return;
    setQuery("");
    setRefreshError(undefined);
  }, [props.open]);

  const pull = (): Promise<void> =>
    props.onRefresh().then(
      () => setRefreshError(undefined),
      (cause: unknown) => {
        console.warn("[models] pull to refresh failed", cause);
        setRefreshError(cause instanceof Error ? cause.message : String(cause));
      },
    );

  // Searching, the first match is the one Return picks: highlighted, the list
  // inset a little so its highlight rounds inside the card. Lazy stacks: the
  // window resizes every frame as it grows or is dragged, and laying out every
  // row of every page each frame (over a hundred) dropped frames.
  // The search and the tabs float over the lists and slide down out of the way
  // as a list scrolls down, back as it scrolls up (or reaches its top). Read on
  // the UI thread, from the list's scroll geometry.
  const barsDrop = useSharedValue(0);
  const barsHidden = useSharedValue(false);
  const lastOffset = useSharedValue(0);
  const scrollGeometry = useScrollGeometryChange((g) => {
    "worklet";
    const dy = g.contentOffsetY - lastOffset.value;
    lastOffset.value = g.contentOffsetY;
    // A jump is another page's list, not a scroll.
    if (dy > SCROLL_JUMP || dy < -SCROLL_JUMP) return;
    const atTop = g.contentOffsetY <= 0;
    const atEnd = g.contentOffsetY + g.containerHeight >= g.contentHeight;
    if (!barsHidden.value && dy > 0 && !atTop) {
      barsHidden.value = true;
      barsDrop.value = withTiming(BARS_HIDE, { duration: BARS_MS, easing: Easing.out(Easing.cubic) });
    } else if (barsHidden.value && (atTop || (dy < 0 && !atEnd))) {
      barsHidden.value = false;
      barsDrop.value = withTiming(0, { duration: BARS_MS, easing: Easing.out(Easing.cubic) });
    }
  });
  React.useEffect(() => {
    if (!props.open) return;
    barsHidden.value = false;
    barsDrop.value = 0;
  }, [props.open, barsHidden, barsDrop]);
  const tabsStyle = useAnimatedStyle(() => ({ bottom: PILL_AREA - barsDrop.value }));

  // Searching, the first match is the one Return picks: highlighted, the list
  // inset a little so its highlight rounds inside the card. Lazy stacks: the
  // window resizes every frame as it grows or is dragged, and laying out every
  // row of every page each frame (over a hundred) dropped frames.
  const rows = (models: ReadonlyArray<ModelOption>, showProvider: boolean, pickFirst: boolean): React.ReactElement => (
    <ScrollView modifiers={[scrollDismissesKeyboard("immediately"), refreshable(pull), ...(scrollGeometry !== null ? [scrollGeometry] : [])]}>
      <LazyVStack spacing={8} alignment="leading" modifiers={[padding({ horizontal: SIDE, top: HANDLE_CLEARANCE, bottom: UNDER_BARS })]}>
        {refreshError !== undefined ? (
          <Text modifiers={[font({ size: 13 }), foregroundStyle("red"), lineLimit(2)]}>{refreshError}</Text>
        ) : null}
        <LazyVStack
          spacing={0}
          alignment="leading"
          modifiers={[
            padding({ all: pickFirst ? PICK_INSET : 0 }),
            glassEffect({ glass: { variant: "regular", tint: cardTint }, shape: "roundedRectangle", cornerRadius: CARD_RADIUS }),
          ]}
        >
          {models.map((model, index) => (
            <VStack key={modelKey(model)} spacing={0} alignment="leading">
              {index > 0 ? <Divider modifiers={[padding({ leading: 16 })]} /> : null}
              <ModelRow
                model={model}
                showProvider={showProvider}
                active={modelKey(model) === selectedKey}
                picked={pickFirst && index === 0 ? themeColors.bubbleGlassTint : undefined}
                onPress={props.onChoose}
              />
            </VStack>
          ))}
        </LazyVStack>
      </LazyVStack>
    </ScrollView>
  );

  return (
    <BarWindow
      open={props.open}
      instant={false}
      onClose={props.onClose}
      inputRef={inputRef}
      glass="regular"
      tintColor={cardTint}
      detent={modelDetent}
      hiddenCollapsed
      onHidden={onHidden}
      stop={MODEL_STOP}
      closeLabel="Close models"
      pillLowered={barsDrop}
      body={
        live || props.open ? (
          <View style={styles.body}>
            <Host style={styles.list} ignoreSafeArea="all">
              <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "top" })]}>
                {searching ? (
                  results.length > 0 ? (
                    rows(results, true, true)
                  ) : (
                    <Empty text="No models match" />
                  )
                ) : (
                  <TabView selection={current} onSelectionChange={setTab} modifiers={[tabViewStyle({ type: "page", indexDisplayMode: "never" })]}>
                    {tabs.map((t) => (
                      <TabView.Tab key={t.id} value={t.id}>
                        {t.models.length > 0 ? rows(t.models, t.showProvider, false) : <Empty text="Models you send with show here" />}
                      </TabView.Tab>
                    ))}
                  </TabView>
                )}
              </VStack>
            </Host>
            {/* The tabs, floating over the list just above the search. */}
            <Reanimated.View style={[styles.tabsFloat, tabsStyle]} pointerEvents="box-none">
              <Host style={styles.tabsHost} ignoreSafeArea="all">
                {CapsuleTabs !== undefined ? (
                  <CapsuleTabs
                    tabs={tabs.map((t) => ({ id: t.id, title: t.title, systemImage: t.icon }))}
                    selection={current}
                    tint={themeColors.bubbleGlassTint}
                    sideMargin={SIDE}
                    onSelect={setTab}
                  />
                ) : (
                  <FallbackTabs tabs={tabs} current={current} tint={themeColors.bubbleGlassTint} onSelect={setTab} />
                )}
              </Host>
            </Reanimated.View>
          </View>
        ) : null
      }
      pill={
        <>
          <View style={styles.searchIcon}>
            <Feather name="search" size={17} color={textColors.secondaryLabel} />
          </View>
          <TextInput
            ref={inputRef}
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search models"
            placeholderTextColor={textColors.placeholderText}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="go"
            submitBehavior="submit"
            onSubmitEditing={() => {
              const first = searching ? results[0] : undefined;
              if (first !== undefined) props.onChoose(first);
            }}
          />
        </>
      }
    />
  );
});

/** The tab strip in @expo/ui, for a build without the native CapsuleTabs. */
const FallbackTabs = (props: {
  readonly tabs: ReadonlyArray<ModelTab>;
  readonly current: string;
  readonly tint: string;
  readonly onSelect: (id: string) => void;
}): React.ReactElement => (
  <ScrollView axes="horizontal" modifiers={[scrollIndicators("hidden")]}>
    <HStack
      spacing={6}
      modifiers={[padding({ horizontal: SIDE, vertical: 10 })]}
    >
      {props.tabs.map((t) => {
        const active = t.id === props.current;
        // Recents collapses to its clock: its title stays, its
        // frame narrowing to nothing (clipped), so the capsule
        // shrinks around the icon.
        const collapsed = t.icon !== undefined && !active;
        return (
          <HStack
            key={t.id}
            spacing={0}
            modifiers={[
              font({ size: 13, weight: active ? "semibold" : "medium" }),
              foregroundStyle({ type: "hierarchical", style: active ? "primary" : "secondary" }),
              frame({ minWidth: TAB_HEIGHT, height: TAB_HEIGHT }),
              padding({ horizontal: collapsed ? 0 : 11 }),
              glassEffect({
                glass: { variant: "regular", tint: active ? props.tint : undefined },
                shape: "capsule",
              }),
              contentShape(shapes.capsule()),
              onTapGesture(() => props.onSelect(t.id)),
              animation(TAB_SPRING, active),
            ]}
          >
            {t.icon !== undefined ? <Image systemName={t.icon} size={14} /> : null}
            <Text
              modifiers={[
                lineLimit(1),
                fixedSize(),
                padding({ leading: t.icon !== undefined ? 5 : 0 }),
                frame({ maxWidth: collapsed ? 0 : TAB_TITLE_MAX_WIDTH, alignment: "leading" }),
                clipped(),
                animation(TAB_SPRING, active),
              ]}
            >
              {t.title}
            </Text>
          </HStack>
        );
      })}
    </HStack>
  </ScrollView>
);

const Empty = (props: { readonly text: string }): React.ReactElement => (
  <VStack modifiers={[padding({ top: 32 }), frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "top" })]}>
    <Text modifiers={[font({ size: 15 }), foregroundStyle({ type: "hierarchical", style: "secondary" })]}>{props.text}</Text>
  </VStack>
);

const ModelRow = (props: {
  readonly model: ModelOption;
  readonly showProvider: boolean;
  readonly active: boolean;
  /** Return picks this row: its highlight's colour. */
  readonly picked: string | undefined;
  readonly onPress: (model: ModelOption) => void;
}): React.ReactElement => (
  <HStack
    spacing={8}
    modifiers={[
      padding({ horizontal: 16, vertical: 12 }),
      frame({ maxWidth: Infinity, alignment: "leading" }),
      ...(props.picked !== undefined ? [background(props.picked, shapes.roundedRectangle({ cornerRadius: CARD_RADIUS - PICK_INSET }))] : []),
      contentShape(shapes.rectangle()),
      onTapGesture(() => props.onPress(props.model)),
    ]}
  >
    <VStack spacing={2} alignment="leading">
      <Text modifiers={[font({ size: 15, weight: props.active ? "semibold" : "regular" }), lineLimit(1), truncationMode("middle")]}>
        {props.model.name}
      </Text>
      {props.showProvider ? (
        <Text modifiers={[font({ size: 12 }), foregroundStyle({ type: "hierarchical", style: "secondary" }), lineLimit(1)]}>
          {props.model.providerName}
        </Text>
      ) : null}
    </VStack>
    <Spacer />
    {props.picked !== undefined ? (
      <Image systemName="return" size={13} color="secondary" />
    ) : props.active ? (
      <Image systemName="checkmark" size={13} />
    ) : null}
  </HStack>
);

const styles = StyleSheet.create({
  host: {
    width: LABEL_MAX_WIDTH,
    height: COMPOSER_CHIP_SIZE,
    maxWidth: "100%",
  },
});

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    // The lists fill the window; the tabs and search float over them.
    body: {
      flex: 1,
    },
    list: {
      flex: 1,
    },
    tabsFloat: {
      position: "absolute",
      left: 0,
      right: 0,
      height: TABS_ROW,
    },
    tabsHost: {
      flex: 1,
    },
    // The search icon, centred on the pill's one line.
    searchIcon: {
      width: COMPOSER_SEND_CHIP_SIZE,
      height: COMPOSER_SEND_CHIP_SIZE,
      alignItems: "center",
      justifyContent: "center",
    },
    // One line, as tall as send, so the pill is the bar's height.
    search: {
      flex: 1,
      height: COMPOSER_SEND_CHIP_SIZE,
      color: text.label,
      fontSize: 16,
      lineHeight: SEARCH_LINE_HEIGHT,
      paddingVertical: 0,
      paddingHorizontal: 0,
    },
  });
