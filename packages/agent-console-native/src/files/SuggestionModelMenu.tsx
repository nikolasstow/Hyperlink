/**
 * The model inline suggestions are written by (suggestionSettings.ts), as a
 * native menu: Default (named: the fast model it stands for), then each
 * provider's models. Its label
 * is the model chosen, at the row's end, in a set box.
 *
 * @internal
 */
import { Button, Host, HStack, Image, Menu, Text } from "@expo/ui/swift-ui";
import { buttonStyle, font, foregroundStyle, frame, lineLimit, menuIndicator, menuStyle, truncationMode } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { type ModelOption, useModels } from "../models";
import { useTextColors } from "../theme";
import { Complete } from "agent-console-protocol";
import { setSuggestionSettings, useSuggestionSettings } from "./suggestionSettings";

const WIDTH = 200;
/** The local fill-in-the-middle model on the Mac (Complete.local). */
const LOCAL_LABEL = "Local (Qwen2.5-Coder)";
const HEIGHT = 32;

export const SuggestionModelMenu = (): React.ReactElement => {
  const textColors = useTextColors();
  const settings = useSuggestionSettings();
  const models = useModels(undefined);
  const chosen = settings.model === undefined ? undefined : models.find((model) => model.providerID === settings.model?.providerID && model.modelID === settings.model.id);
  // What Default stands for: the local model when it runs, else the server's
  // pick of a chat model, by the same rule.
  const fallbackRef = Complete.defaultModel(models.map((model) => ({ providerID: model.providerID, id: model.modelID })));
  const fallback = fallbackRef === undefined ? undefined : models.find((model) => model.providerID === fallbackRef.providerID && model.modelID === fallbackRef.id);
  const defaultLabel = `Default (Local Qwen, else ${fallback?.name ?? "a chat model"})`;
  const isLocal = settings.model?.providerID === Complete.local.providerID;
  const label = settings.model === undefined ? "Default" : isLocal ? LOCAL_LABEL : (chosen?.name ?? settings.model.id);
  const byProvider = React.useMemo(() => {
    const groups = new Map<string, { readonly name: string; readonly models: Array<ModelOption> }>();
    for (const model of models) {
      const group = groups.get(model.providerID) ?? { name: model.providerName, models: [] };
      group.models.push(model);
      groups.set(model.providerID, group);
    }
    return [...groups.entries()];
  }, [models]);
  const choose = (model: ModelOption | undefined): void =>
    setSuggestionSettings(model === undefined ? { enabled: settings.enabled } : { enabled: settings.enabled, model: { providerID: model.providerID, id: model.modelID } });
  return (
    <Host style={{ width: WIDTH, height: HEIGHT }} ignoreSafeArea="all">
      <Menu
        label={
          <HStack spacing={4} modifiers={[frame({ width: WIDTH, height: HEIGHT, alignment: "trailing" })]}>
            <Text modifiers={[font({ size: 16 }), foregroundStyle(textColors.secondaryLabel), lineLimit(1), truncationMode("middle")]}>{label}</Text>
            <Image systemName="chevron.up.chevron.down" size={12} color={textColors.secondaryLabel} />
          </HStack>
        }
        modifiers={[menuStyle("button"), buttonStyle("plain"), menuIndicator("hidden")]}
      >
        <Button label={defaultLabel} {...(settings.model === undefined ? { systemImage: "checkmark" } : {})} onPress={() => choose(undefined)} />
        <Button
          label={LOCAL_LABEL}
          {...(isLocal ? { systemImage: "checkmark" } : {})}
          onPress={() => setSuggestionSettings({ enabled: settings.enabled, model: Complete.local })}
        />
        {byProvider.map(([providerID, group]) => (
          <Menu key={providerID} label={group.name}>
            {group.models.map((model) => (
              <Button
                key={model.modelID}
                label={model.name}
                {...(settings.model?.providerID === providerID && settings.model.id === model.modelID ? { systemImage: "checkmark" } : {})}
                onPress={() => choose(model)}
              />
            ))}
          </Menu>
        ))}
      </Menu>
    </Host>
  );
};
