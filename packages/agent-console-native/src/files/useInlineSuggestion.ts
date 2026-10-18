/**
 * The inline suggestion for the open file (docs/handoffs/code-intelligence.md):
 * asked for once typing pauses with the caret in place, and shown as it
 * streams in (it grows as the model writes); an answer that comes after the
 * text or caret moved is dropped. What shows, and when it goes, is
 * the editor's (InlineSuggestion.swift: only while the caret is where it was
 * made for; a first space keeps it for the double space). So a suggestion is
 * not cleared here as typing goes on: that would take it away between the
 * two spaces. Off when the setting is off.
 *
 * @internal
 */
import { Effect, Fiber, Stream } from "effect";
import * as React from "react";
import { useAppContext } from "../AppContext";
import { forkApp } from "../effect/runtime";
import { InlineSuggestions } from "../language/complete";
import { useSuggestionSettings } from "./suggestionSettings";

/** How long typing must pause before a suggestion is asked for. */
const PAUSE_MS = 150;

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
    // Typing on cancels the request in flight (its fetch is aborted), as the
    // best editors do: only the latest pause is asked about.
    let request: Fiber.Fiber<unknown> | undefined;
    const timer = setTimeout(() => {
      request = forkApp(
        InlineSuggestions.pipe(
          Effect.flatMap((suggestions) =>
            suggestions.at(server, path, text, caret, model).pipe(
              // Shown as it grows (one id: the editor redraws it in place).
              Stream.runForEach((found) =>
                Effect.sync(() => {
                  // Only for the text and caret it was asked about.
                  if (asked.current === id && found !== "") setSuggestion({ id: String(id), at: caret, text: found });
                }),
              ),
            ),
          ),
          Effect.catch((error) => Effect.logWarning(`[suggestions] none for ${path}`, error)),
        ),
      );
    }, PAUSE_MS);
    return () => {
      clearTimeout(timer);
      if (request !== undefined) forkApp(Fiber.interrupt(request));
    };
  }, [server, path, text, caret, settings.enabled, model]);
  return suggestion;
};
