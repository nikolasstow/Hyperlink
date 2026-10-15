/**
 * A model's effort (opencode's variant): how a message names it, and how a
 * picker shows it. Pure, so anything can import it.
 *
 * @internal
 */
import type { ModelOption } from "../models";
import { Model } from "../opencode/schema/model";
import { Provider } from "../opencode/schema/provider";

/** What a message is sent with: the model, at `effort` when one is chosen
 * (else the model's own default). */
export const modelRefOf = (model: ModelOption, effort: string | undefined): Model.Ref =>
  Model.Ref.make({
    providerID: Provider.ID.make(model.providerID),
    id: Model.ID.make(model.modelID),
    ...(effort === undefined ? {} : { variant: Model.VariantID.make(effort) }),
  });

/** An effort level as a picker shows it. */
export const effortLabel = (effort: string | undefined): string => {
  switch (effort) {
    case undefined:
      return "Default";
    case "xhigh":
      return "Extra High";
    default:
      return effort.charAt(0).toUpperCase() + effort.slice(1);
  }
};
