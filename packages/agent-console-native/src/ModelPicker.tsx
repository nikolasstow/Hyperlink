/**
 * Composer model selector: the model's name, and on a tap a native popover of
 * the connected models in pages, a tab strip over them. Recents first (the
 * models last sent with), then a page per provider, the most used providers
 * first. Swipe between pages or tap a tab. The popover reads the models store
 * live, so a refresh landing while it is open shows at once.
 *
 * Label is the model name (or “Model” while loading); not “Auto” (Cursor’s
 * routing feature, which we don’t replicate). Provider titles are the server’s
 * `name` as-is, no client-side title-casing.
 *
 * @internal
 */
import { Host, HStack, Image, Popover, ScrollView, Spacer, TabView, Text, VStack } from "@expo/ui/swift-ui";
import {
  contentShape,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  lineLimit,
  onTapGesture,
  padding,
  scrollIndicators,
  shapes,
  tabViewStyle,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet } from "react-native";
import { COMPOSER_CHIP_SIZE } from "./composerBarSpec";
import { modelKey, type ModelOption } from "./models";
import { type ModelUsage, useModelUsage } from "./modelUsage";
import { useTextColors, useTheme } from "./theme";

const RECENTS = "recents";
const RECENTS_LIMIT = 8;
const POPOVER_WIDTH = 300;
const POPOVER_HEIGHT = 380;
const LABEL_MAX_WIDTH = 220;

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

export const ModelPicker = (props: Props): React.ReactElement => {
  const textColors = useTextColors();
  const { colors: themeColors } = useTheme();
  const usage = useModelUsage();
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState(RECENTS);
  const label = props.selected?.name ?? (props.models.length === 0 ? "Model…" : "Model");
  const tabs = React.useMemo(() => tabsOf(props.models, usage), [props.models, usage]);
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? RECENTS;
  const selectedKey = props.selected !== undefined ? modelKey(props.selected) : undefined;

  const choose = (model: ModelOption): void => {
    props.onChange(model);
    setOpen(false);
  };

  return (
    <Host style={styles.host} matchContents={{ horizontal: true }} ignoreSafeArea="all">
      <Popover isPresented={open} onIsPresentedChange={setOpen} attachmentAnchor="top" arrowEdge="bottom">
        <Popover.Trigger>
          <HStack
            spacing={4}
            modifiers={[
              frame({ maxWidth: LABEL_MAX_WIDTH, height: COMPOSER_CHIP_SIZE }),
              padding({ trailing: 4 }),
              contentShape(shapes.rectangle()),
              onTapGesture(() => setOpen(true)),
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
        </Popover.Trigger>
        <Popover.Content>
          <VStack spacing={0} modifiers={[frame({ width: POPOVER_WIDTH, height: POPOVER_HEIGHT })]}>
            <ScrollView axes="horizontal" modifiers={[scrollIndicators("hidden")]}>
              <HStack spacing={6} modifiers={[padding({ horizontal: 12, vertical: 10 })]}>
                {tabs.map((t) => {
                  const active = t.id === current;
                  return (
                    <Text
                      key={t.id}
                      modifiers={[
                        font({ size: 13, weight: active ? "semibold" : "medium" }),
                        foregroundStyle({ type: "hierarchical", style: active ? "primary" : "secondary" }),
                        lineLimit(1),
                        padding({ horizontal: 12, vertical: 6 }),
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
                  <ScrollView>
                    <VStack spacing={0} alignment="leading" modifiers={[padding({ bottom: 8 })]}>
                      {t.models.map((model) => (
                        <ModelRow
                          key={modelKey(model)}
                          model={model}
                          showProvider={t.showProvider}
                          active={modelKey(model) === selectedKey}
                          onPress={choose}
                        />
                      ))}
                    </VStack>
                  </ScrollView>
                </TabView.Tab>
              ))}
            </TabView>
          </VStack>
        </Popover.Content>
      </Popover>
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
      padding({ horizontal: 16, vertical: 10 }),
      frame({ maxWidth: POPOVER_WIDTH, alignment: "leading" }),
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
