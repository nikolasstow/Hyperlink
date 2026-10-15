/**
 * The inline suggestion for the open file (docs/handoffs/code-intelligence.md):
 * asked for once typing pauses with the caret in place; an answer that comes
 * after the text or caret moved is dropped. What shows, and when it goes, is
 * the editor's (InlineSuggestion.swift: only while the caret is where it was
 * made for; a first space keeps it for the double space). So a suggestion is
 * not cleared here as typing goes on: that would take it away between the
 * two spaces. Off when the setting is off.
 *
 * @internal
 */
import { Effect } from "effect";
import * as React from "react";
import { useAppContext } from "../AppContext";
import { runFs } from "../effect/runtime";
import { completeAt } from "../language/complete";
import { useSuggestionSettings } from "./suggestionSettings";

/** How long typing must pause before a suggestion is asked for. */
const PAUSE_MS = 600;

export interface Suggestion {
  readonly id: string;
  readonly at: number;
  readonly text: string;
}

/** The suggestion for `text` at `caret` (undefined: none, or not editing). */
export const useInlineSuggestion = (path: string, text: string | undefined, caret: number | undefined): Suggestion | undefined => {
  const { server } = useAppContext();
  const settings = useSuggestionSettings();
  // The model chosen (none: the server picks). One value per model, so the
  // request waits on the model, not on renders.
  const providerID = settings.model?.providerID;
  const modelID = settings.model?.id;
  const model = React.useMemo(() => (providerID === undefined || modelID === undefined ? undefined : { providerID, id: modelID }), [providerID, modelID]);
  const [suggestion, setSuggestion] = React.useState<Suggestion | undefined>(undefined);
  const asked = React.useRef(0);
  React.useEffect(() => {
    if (!settings.enabled) {
      setSuggestion(undefined);
      return undefined;
    }
    if (text === undefined || caret === undefined) return undefined;
    const id = ++asked.current;
    const timer = setTimeout(() => {
      void runFs(
        completeAt(server, path, text, caret, model).pipe(
          Effect.catch((error) => Effect.logWarning(`[suggestions] none for ${path}`, error).pipe(Effect.as(""))),
        ),
      ).then((found) => {
        // Only for the text and caret it was asked about.
        if (asked.current !== id || found === "") return;
        setSuggestion({ id: String(id), at: caret, text: found });
      });
    }, PAUSE_MS);
    return () => clearTimeout(timer);
  }, [server, path, text, caret, settings.enabled, model]);
  return suggestion;
};
