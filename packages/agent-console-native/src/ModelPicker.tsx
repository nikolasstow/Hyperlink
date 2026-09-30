/**
 * The composer's model: its name in the bar, and on a tap the model window, a
 * BarWindow (grown up out of the bar, riding the keyboard as the bar does,
 * regular glass). Its pill is the pages' tabs, iOS's segmented control
 * (Recents, then each provider, the most used first); above it the search,
 * focused as it opens; above that the page's models. Swipe between pages or
 * tap a tab; typing swaps the pages for every model matching. Pull a list
 * down to have the server fetch the models.dev catalog now. The window reads
 * the models store live, so a refresh landing while it is open shows at once.
 *
 * Label is the model name (or “Model” while loading); not “Auto” (Cursor’s
 * routing feature, which we don’t replicate). Provider titles are the server’s
 * `name` as-is, no client-side title-casing.
 *
 * @internal
 */
import { Feather } from "@expo/vector-icons";
import { Divider, Host, HStack, Image, Picker, ScrollView, Spacer, TabView, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  contentShape,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  lineLimit,
  onTapGesture,
  padding,
  pickerStyle,
  refreshable,
  scrollDismissesKeyboard,
  shapes,
  tabViewStyle,
  tag,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { BarWindow, type CloseReason, detentMemory, HANDLE_CLEARANCE } from "./BarWindow";
import { CARD_RADIUS } from "./CardGlass";
import { COMPOSER_CHIP_SIZE, COMPOSER_SEND_CHIP_SIZE } from "./composerBarSpec";
import { modelKey, type ModelOption } from "./models";
import { type ModelUsage, useModelUsage } from "./modelUsage";
import { type TextColors, useCardTint, useTextColors, useThemedStyles } from "./theme";

const RECENTS = "recents";
const RECENTS_LIMIT = 8;
const LABEL_MAX_WIDTH = 220;
/** The list's side margin, for the tabs and the list alike. */
const SIDE = 16;
/** The search field's height, and its gap above the tabs' pill. */
const SEARCH_HEIGHT = 40;
const SEARCH_GAP = 10;

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
  /** Recents' clock: its segment shows the icon alone. */
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
    <Host style={styles.host} matchContents={{ horizontal: true }} ignoreSafeArea="all">
      <HStack
        spacing={4}
        modifiers={[
          frame({ maxWidth: LABEL_MAX_WIDTH, height: COMPOSER_CHIP_SIZE }),
          padding({ trailing: 4 }),
          contentShape(shapes.rectangle()),
          onTapGesture(props.onPress),
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

/** The model window: search in its pill, the pages above. */
export const ModelWindow = (props: {
  readonly open: boolean;
  readonly models: ReadonlyArray<ModelOption>;
  readonly selected: ModelOption | undefined;
  readonly onChoose: (model: ModelOption) => void;
  readonly onClose: (reason: CloseReason) => void;
  /** Pulled to refresh: the server fetches the catalog now, then the list reloads. */
  readonly onRefresh: () => Promise<void>;
}): React.ReactElement | null => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
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

  const rows = (models: ReadonlyArray<ModelOption>, showProvider: boolean): React.ReactElement => (
    <ScrollView modifiers={[scrollDismissesKeyboard("immediately"), refreshable(pull)]}>
      <VStack
        spacing={0}
        alignment="leading"
        modifiers={[
          glassEffect({ glass: { variant: "regular", tint: cardTint }, shape: "roundedRectangle", cornerRadius: CARD_RADIUS }),
          padding({ horizontal: SIDE, top: HANDLE_CLEARANCE }),
        ]}
      >
        {models.map((model, index) => (
          <VStack key={modelKey(model)} spacing={0} alignment="leading">
            {index > 0 ? <Divider modifiers={[padding({ leading: 16 })]} /> : null}
            <ModelRow model={model} showProvider={showProvider} active={modelKey(model) === selectedKey} onPress={props.onChoose} />
          </VStack>
        ))}
      </VStack>
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
      stop={MODEL_STOP}
      closeLabel="Close models"
      body={
        <View style={styles.body}>
          <Host style={styles.list} ignoreSafeArea="all">
            <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "top" })]}>
              {searching ? (
                results.length > 0 ? (
                  rows(results, true)
                ) : (
                  <Empty text="No models match" />
                )
              ) : (
                <TabView selection={current} onSelectionChange={setTab} modifiers={[tabViewStyle({ type: "page", indexDisplayMode: "never" })]}>
                  {tabs.map((t) => (
                    <TabView.Tab key={t.id} value={t.id}>
                      {t.models.length > 0 ? rows(t.models, t.showProvider) : <Empty text="Models you send with show here" />}
                    </TabView.Tab>
                  ))}
                </TabView>
              )}
              {refreshError !== undefined ? (
                <Text
                  modifiers={[
                    font({ size: 13 }),
                    foregroundStyle("red"),
                    lineLimit(2),
                    padding({ horizontal: SIDE, top: 8 }),
                    frame({ maxWidth: Infinity, alignment: "leading" }),
                  ]}
                >
                  {refreshError}
                </Text>
              ) : null}
            </VStack>
          </Host>
          {/* The search, above the tabs: an iOS search field (a filled capsule;
            * no glass, as the body is cropped). */}
          <View style={styles.searchField}>
            <Feather name="search" size={16} color={textColors.secondaryLabel} />
            <TextInput
              ref={inputRef}
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search models"
              placeholderTextColor={textColors.placeholderText}
              autoCorrect={false}
              autoCapitalize="none"
              editable={props.open}
            />
          </View>
        </View>
      }
      pill={
        // The pages' tabs: iOS's segmented control, a pill within the pill.
        <Host style={styles.tabs} ignoreSafeArea="all">
          <Picker
            selection={current}
            onSelectionChange={(value) => {
              if (typeof value === "string") setTab(value);
            }}
            modifiers={[pickerStyle("segmented")]}
          >
            {tabs.map((t) =>
              t.icon !== undefined ? (
                <Image key={t.id} systemName={t.icon} modifiers={[tag(t.id), accessibilityLabel(t.title)]} />
              ) : (
                <Text key={t.id} modifiers={[tag(t.id)]}>
                  {t.title}
                </Text>
              ),
            )}
          </Picker>
        </Host>
      }
    />
  );
};

const Empty = (props: { readonly text: string }): React.ReactElement => (
  <VStack modifiers={[padding({ top: 32 }), frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "top" })]}>
    <Text modifiers={[font({ size: 15 }), foregroundStyle({ type: "hierarchical", style: "secondary" })]}>{props.text}</Text>
  </VStack>
);

const ModelRow = (props: {
  readonly model: ModelOption;
  readonly showProvider: boolean;
  readonly active: boolean;
  readonly onPress: (model: ModelOption) => void;
}): React.ReactElement => (
  <HStack
    spacing={8}
    modifiers={[
      padding({ horizontal: 16, vertical: 12 }),
      frame({ maxWidth: Infinity, alignment: "leading" }),
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
    {props.active ? <Image systemName="checkmark" size={13} /> : null}
  </HStack>
);

const styles = StyleSheet.create({
  host: {
    height: COMPOSER_CHIP_SIZE,
    maxWidth: "100%",
    alignSelf: "flex-start",
  },
});

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    // The pages and their tabs fill the space above the pill.
    list: {
      flex: 1,
    },
    // The list above, the search under it.
    body: {
      flex: 1,
    },
    // The search: an iOS search field, above the tabs.
    searchField: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      height: SEARCH_HEIGHT,
      marginHorizontal: SIDE,
      marginBottom: SEARCH_GAP,
      paddingHorizontal: 12,
      borderRadius: SEARCH_HEIGHT / 2,
      backgroundColor: "rgba(120,120,128,0.16)",
    },
    search: {
      flex: 1,
      height: SEARCH_HEIGHT,
      color: text.label,
      fontSize: 16,
      paddingVertical: 0,
      paddingHorizontal: 0,
    },
    // The segmented control fills the pill's row.
    tabs: {
      flex: 1,
      height: COMPOSER_SEND_CHIP_SIZE,
    },
  });
