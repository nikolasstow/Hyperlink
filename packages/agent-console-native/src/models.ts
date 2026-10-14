/**
 * The models a composer can pick, from the model catalog
 * (models/ModelCatalog.ts): kept on the device, read back at launch, fetched
 * again at app open and on return to the foreground. A folder never loaded
 * shows the server's own list while its own loads (opencode keeps one list
 * per folder; `undefined` is the server's own).
 *
 * @internal
 */
import * as React from "react";
import { authedFetch } from "./auth/serverTokens";
import type { Catalog } from "./models/ModelCatalog";
import { catalogNow, hasOwnCatalog, refreshCatalog, useCatalog } from "./models/useModelCatalog";

export type ModelOption = {
  readonly providerID: string;
  /** Provider display name from the server (`provider.name`), not reformatted. */
  readonly providerName: string;
  readonly modelID: string;
  readonly name: string;
};

export const modelKey = (model: Pick<ModelOption, "providerID" | "modelID">): string =>
  `${model.providerID}/${model.modelID}`;

const EMPTY: ReadonlyArray<ModelOption> = [];

/** A catalog's models as options, made once per catalog (its identity). */
const optionsByCatalog = new WeakMap<Catalog, ReadonlyArray<ModelOption>>();
const optionsOf = (catalog: Catalog | undefined): ReadonlyArray<ModelOption> => {
  if (catalog === undefined) return EMPTY;
  const known = optionsByCatalog.get(catalog);
  if (known !== undefined) return known;
  const options = catalog.providers.flatMap((provider) =>
    provider.models.map((model) => ({
      providerID: provider.id,
      providerName: provider.name,
      modelID: model.id,
      name: model.name,
    })),
  );
  optionsByCatalog.set(catalog, options);
  return options;
};

/**
 * A folder's models, as they change. Its own list is fetched the first time
 * the folder is seen; the server's own shows meanwhile.
 */
export const useModels = (directory: string | undefined): ReadonlyArray<ModelOption> => {
  React.useEffect(() => {
    if (!hasOwnCatalog(directory)) void refreshCatalog(directory);
  }, [directory]);
  return optionsOf(useCatalog(directory));
};

/** A folder's models now (fetching them first if nothing is kept). */
export const listModels = async (directory: string | undefined): Promise<ReadonlyArray<ModelOption>> => {
  if (catalogNow(directory) === undefined) await refreshCatalog(directory);
  return optionsOf(catalogNow(directory));
};

/**
 * A folder's default model: opencode's own last resort, the first configured
 * provider's default (its config's `model` and the models used last come
 * first, but are not served; the composer prefers the user's last model).
 */
export const getDefaultModel = (directory: string | undefined): ModelOption | undefined => {
  const catalog = catalogNow(directory);
  const provider = catalog?.providers.find((each) => catalog.defaults[each.id] !== undefined);
  const modelID = provider === undefined ? undefined : catalog?.defaults[provider.id];
  return provider === undefined || modelID === undefined ? undefined : findModel(optionsOf(catalog), provider.id, modelID);
};

/**
 * Has the server fetch the models.dev catalog now and rebuild its model lists
 * from it (`POST /provider/refresh`, from our opencode patch), then loads the
 * folder's list afresh. Throws when the server can't refresh, so the caller
 * can say so.
 */
export const reloadModels = async (address: string, directory: string | undefined): Promise<void> => {
  const response = await authedFetch(`${address}/provider/refresh`, { method: "POST" });
  if (!response.ok) throw new Error(`Model refresh failed: HTTP ${response.status} ${await response.text()}`);
  await refreshCatalog(directory);
};

export const findModel = (
  options: ReadonlyArray<ModelOption>,
  providerID: string,
  modelID: string,
): ModelOption | undefined => options.find((o) => o.providerID === providerID && o.modelID === modelID);
