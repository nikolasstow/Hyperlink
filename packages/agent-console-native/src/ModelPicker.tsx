/**
 * Composer model selector: the model's name, and on a tap a native sheet of
 * the connected models: a search field (focused as it opens) over the models
 * in pages, a tab strip over them. Recents first (the models last sent with),
 * then a page per provider, the most used providers first. Swipe between pages
 * or tap a tab; typing swaps the pages for every model matching. The sheet
 * reads the models store live, so a refresh landing while it is open shows at
 * once.
 *
 * Label is the model name (or “Model” while loading); not “Auto” (Cursor’s
 * routing feature, which we don’t replicate). Provider titles are the server’s
 * `name` as-is, no client-side title-casing.
 *
 * @internal
 */
import { BottomSheet, Divider, Group, Host, HStack, Image, ScrollView, Spacer, TabView, Text, TextField, VStack } from "@expo/ui/swift-ui";
import {
  Animation,
  animation,
  autocorrectionDisabled,
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
  type PresentationDetent,
  presentationDetents,
  presentationDragIndicator,
  refreshable,
  scrollDismissesKeyboard,
  scrollIndicators,
  shapes,
  tabViewStyle,
  textFieldStyle,
  textInputAutocapitalization,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet } from "react-native";
import { CapsuleTabs } from "../modules/capsule-tabs";
import { CARD_RADIUS } from "./CardGlass";
import { COMPOSER_CHIP_SIZE } from "./composerBarSpec";
import { modelKey, type ModelOption } from "./models";
import { type ModelUsage, useModelUsage } from "./modelUsage";
import { useCardTint, useTextColors, useTheme } from "./theme";
import { lastKeyboardHeight } from "./useKeyboardHeight";

const RECENTS = "recents";
const RECENTS_LIMIT = 8;
const LABEL_MAX_WIDTH = 220;
/** The sheet's side margin, for the search, the tabs and the list alike. */
const SIDE = 20;
const SEARCH_HEIGHT = 44;
const TAB_HEIGHT = 34;
const TAB_TITLE_MAX_WIDTH = 200;
const TAB_SPRING = Animation.spring({ duration: 0.3, bounce: 0.15 });
/** Above the keyboard's top edge, the sheet's top edge. */
const KEYBOARD_MARGIN = 16;
/** The sheet's opening height before the keyboard has ever shown. */
const FALLBACK: PresentationDetent = { fraction: 0.4 };

/** The sheet's opening height: its top a margin above where the keyboard's top
 * edge is (or was, last it was up). */
const shortDetent = (): PresentationDetent => {
  const keyboard = lastKeyboardHeight();
  return keyboard > 0 ? { height: keyboard + KEYBOARD_MARGIN } : FALLBACK;
};

type Props = {
  readonly models: ReadonlyArray<ModelOption>;
  readonly selected: ModelOption | undefined;
  readonly onChange: (model: ModelOption) => void;
  /** The sheet opened: load the directory's list afresh. */
  readonly onOpen: () => void;
  /** Pulled to refresh: the server fetches the catalog now, then the list reloads. */
  readonly onRefresh: () => Promise<void>;
};

/** One page of the sheet. */
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

export const ModelPicker = (props: Props): React.ReactElement => {
  const textColors = useTextColors();
  const { colors: themeColors } = useTheme();
  const cardTint = useCardTint();
  const usage = useModelUsage();
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState(RECENTS);
  const [query, setQuery] = React.useState("");
  const [refreshError, setRefreshError] = React.useState<string | undefined>(undefined);
  // Each opening mounts a fresh sheet: an empty, focused search.
  const [opening, setOpening] = React.useState(0);
  // The sheet's height, and whether the search holds the keyboard: while it
  // does, the sheet keeps only its current height.
  // Set as the sheet opens, from the keyboard then.
  const [short, setShort] = React.useState<PresentationDetent>(FALLBACK);
  const [detent, setDetent] = React.useState<PresentationDetent>(FALLBACK);
  const [searchFocused, setSearchFocused] = React.useState(true);
  const label = props.selected?.name ?? (props.models.length === 0 ? "Model…" : "Model");
  const tabs = React.useMemo(() => tabsOf(props.models, usage), [props.models, usage]);
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? RECENTS;
  const selectedKey = props.selected !== undefined ? modelKey(props.selected) : undefined;
  const results = React.useMemo(() => matching(props.models, query), [props.models, query]);
  const searching = query.trim().length > 0;

  const show = (): void => {
    setQuery("");
    const height = shortDetent();
    setShort(height);
    setDetent(height);
    setSearchFocused(true);
    setRefreshError(undefined);
    setOpening((n) => n + 1);
    setOpen(true);
    props.onOpen();
  };

  const choose = (model: ModelOption): void => {
    props.onChange(model);
    setOpen(false);
  };

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
          padding({ horizontal: SIDE, bottom: SIDE }),
        ]}
      >
        {models.map((model, index) => (
          <VStack key={modelKey(model)} spacing={0} alignment="leading">
            {index > 0 ? <Divider modifiers={[padding({ leading: 16 })]} /> : null}
            <ModelRow model={model} showProvider={showProvider} active={modelKey(model) === selectedKey} onPress={choose} />
          </VStack>
        ))}
      </VStack>
    </ScrollView>
  );

  return (
    <Host style={styles.host} matchContents={{ horizontal: true }} ignoreSafeArea="all">
      <BottomSheet
        isPresented={open}
        onIsPresentedChange={setOpen}
        anchor={
          <HStack
            spacing={4}
            modifiers={[
              frame({ maxWidth: LABEL_MAX_WIDTH, height: COMPOSER_CHIP_SIZE }),
              padding({ trailing: 4 }),
              contentShape(shapes.rectangle()),
              onTapGesture(show),
            ]}
          >
            <Text
              modifiers={[
                font({ size: 13, weight: "medium" }),
                foregroundStyle(textColors.secondaryLabel),
                lineLimit(1),
                truncationMode("middle"),
              ]}
            >
              {label}
            </Text>
            <Image systemName="chevron.down" size={11} color={textColors.secondaryLabel} />
          </HStack>
        }
      >
        <Group
          key={opening}
          modifiers={[
            presentationDetents(searchFocused ? [detent] : [short, "large"], {
              selection: detent,
              onSelectionChange: (next) => setDetent(next === "large" ? "large" : short),
            }),
            presentationDragIndicator("visible"),
          ]}
        >
          <VStack spacing={0} modifiers={[padding({ top: 10 }), frame({ maxHeight: Infinity, alignment: "top" })]}>
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
            <HStack
              spacing={10}
              modifiers={[
                padding({ horizontal: 16 }),
                frame({ height: SEARCH_HEIGHT }),
                glassEffect({ glass: { variant: "regular", tint: cardTint }, shape: "capsule" }),
                padding({ horizontal: SIDE }),
              ]}
            >
              <Image systemName="magnifyingglass" size={15} color="secondary" />
              <TextField
                autoFocus
                placeholder="Search models"
                onTextChange={setQuery}
                onFocusChange={setSearchFocused}
                modifiers={[textFieldStyle("plain"), autocorrectionDisabled(), textInputAutocapitalization("never")]}
              />
            </HStack>
            {refreshError !== undefined ? (
              <Text
                modifiers={[
                  font({ size: 13 }),
                  foregroundStyle("red"),
                  lineLimit(2),
                  padding({ horizontal: SIDE, top: 10 }),
                  frame({ maxWidth: Infinity, alignment: "leading" }),
                ]}
              >
                {refreshError}
              </Text>
            ) : null}
            <VStack spacing={0} modifiers={[padding({ top: 14 }), frame({ maxHeight: Infinity, alignment: "top" })]}>
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
            </VStack>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
};

/** The tab strip in @expo/ui, for a build without the native CapsuleTabs. */
const FallbackTabs = (props: {
  readonly tabs: ReadonlyArray<ModelTab>;
  readonly current: string;
  readonly tint: string;
  readonly onSelect: (id: string) => void;
}): React.ReactElement => (
  <ScrollView axes="horizontal" modifiers={[scrollIndicators("hidden")]}>
    <HStack
      spacing={8}
      modifiers={[padding({ horizontal: SIDE, vertical: 14 })]}
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
              font({ size: 14, weight: active ? "semibold" : "medium" }),
              foregroundStyle({ type: "hierarchical", style: active ? "primary" : "secondary" }),
              frame({ minWidth: TAB_HEIGHT, height: TAB_HEIGHT }),
              padding({ horizontal: collapsed ? 0 : 14 }),
              glassEffect({
                glass: { variant: active ? "regular" : "identity", tint: props.tint },
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
                padding({ leading: t.icon !== undefined ? 6 : 0 }),
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
