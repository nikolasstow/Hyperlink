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
  autocorrectionDisabled,
  contentShape,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  lineLimit,
  onTapGesture,
  padding,
  presentationDetents,
  presentationDragIndicator,
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
import { CARD_RADIUS } from "./CardGlass";
import { COMPOSER_CHIP_SIZE } from "./composerBarSpec";
import { modelKey, type ModelOption } from "./models";
import { type ModelUsage, useModelUsage } from "./modelUsage";
import { useCardTint, useTextColors, useTheme } from "./theme";

const RECENTS = "recents";
const RECENTS_LIMIT = 8;
const LABEL_MAX_WIDTH = 220;
/** The sheet's side margin, for the search, the tabs and the list alike. */
const SIDE = 20;
const SEARCH_HEIGHT = 44;

type Props = {
  readonly models: ReadonlyArray<ModelOption>;
  readonly selected: ModelOption | undefined;
  readonly onChange: (model: ModelOption) => void;
};

/** One page of the popover. */
interface ModelTab {
  readonly id: string;
  readonly title: string;
  readonly models: ReadonlyArray<ModelOption>;
  /** Rows name their provider (Recents mixes them). */
  readonly showProvider: boolean;
}

// Numbers by value, so a version 10 follows 9.
const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Recents, when any, then each provider, the most sent with first (ties A to Z). */
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
  if (recents.length === 0) return providerTabs;
  return [
    {
      id: RECENTS,
      title: "Recents",
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
  // Each opening mounts a fresh sheet: an empty, focused search.
  const [opening, setOpening] = React.useState(0);
  // The sheet's height, and whether the search holds the keyboard: while it
  // does, the sheet keeps only its current height, since iOS otherwise answers
  // the keyboard by growing a half-height sheet to full.
  const [detent, setDetent] = React.useState<"medium" | "large">("medium");
  const [searchFocused, setSearchFocused] = React.useState(true);
  const label = props.selected?.name ?? (props.models.length === 0 ? "Model…" : "Model");
  const tabs = React.useMemo(() => tabsOf(props.models, usage), [props.models, usage]);
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? RECENTS;
  const selectedKey = props.selected !== undefined ? modelKey(props.selected) : undefined;
  const results = React.useMemo(() => matching(props.models, query), [props.models, query]);
  const searching = query.trim().length > 0;

  const show = (): void => {
    setQuery("");
    setDetent("medium");
    setSearchFocused(true);
    setOpening((n) => n + 1);
    setOpen(true);
  };

  const choose = (model: ModelOption): void => {
    props.onChange(model);
    setOpen(false);
  };

  const rows = (models: ReadonlyArray<ModelOption>, showProvider: boolean): React.ReactElement => (
    <ScrollView modifiers={[scrollDismissesKeyboard("immediately")]}>
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
            presentationDetents(searchFocused ? [detent] : ["medium", "large"], {
              selection: detent,
              onSelectionChange: (next) => {
                if (next === "medium" || next === "large") setDetent(next);
              },
            }),
            presentationDragIndicator("visible"),
          ]}
        >
          <VStack spacing={0} modifiers={[padding({ top: 24 }), frame({ maxHeight: Infinity, alignment: "top" })]}>
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
            {searching ? (
              <VStack spacing={0} modifiers={[padding({ top: 16 }), frame({ maxHeight: Infinity, alignment: "top" })]}>
                {results.length > 0 ? (
                  rows(results, true)
                ) : (
                  <Text modifiers={[font({ size: 15 }), foregroundStyle({ type: "hierarchical", style: "secondary" }), padding({ top: 32 })]}>
                    No models match
                  </Text>
                )}
              </VStack>
            ) : (
              <VStack spacing={0} modifiers={[frame({ maxHeight: Infinity, alignment: "top" })]}>
                <ScrollView axes="horizontal" modifiers={[scrollIndicators("hidden")]}>
                  <HStack spacing={8} modifiers={[padding({ horizontal: SIDE, vertical: 14 })]}>
                    {tabs.map((t) => {
                      const active = t.id === current;
                      return (
                        <Text
                          key={t.id}
                          modifiers={[
                            font({ size: 14, weight: active ? "semibold" : "medium" }),
                            foregroundStyle({ type: "hierarchical", style: active ? "primary" : "secondary" }),
                            lineLimit(1),
                            padding({ horizontal: 14, vertical: 8 }),
                            ...(active
                              ? [glassEffect({ glass: { variant: "regular", tint: themeColors.bubbleGlassTint }, shape: "capsule" })]
                              : []),
                            contentShape(shapes.capsule()),
                            onTapGesture(() => setTab(t.id)),
                          ]}
                        >
                          {t.title}
                        </Text>
                      );
                    })}
                  </HStack>
                </ScrollView>
                <TabView selection={current} onSelectionChange={setTab} modifiers={[tabViewStyle({ type: "page", indexDisplayMode: "never" })]}>
                  {tabs.map((t) => (
                    <TabView.Tab key={t.id} value={t.id}>
                      {rows(t.models, t.showProvider)}
                    </TabView.Tab>
                  ))}
                </TabView>
              </VStack>
            )}
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
};

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
