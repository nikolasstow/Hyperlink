/**
 * The type preview's content for the open file (typePreview.ts): asked of the
 * Mac's language server as the scope you are in changes, a moment after it
 * settles, so tapping the breadcrumbs only shows what is already here.
 *
 * @internal
 */
import { Language } from "agent-console-protocol";
import { Option } from "effect";
import * as React from "react";
import { hoverAt } from "../language/useLanguage";
import type { ScopeSymbol } from "./stickyRanges";
import { type HoverParts, hoverParts, scopeAnchor } from "./typePreview";
import { useLiveFile } from "./useLiveFiles";

/** How long the place must stay put before it is asked about. */
const SETTLE_MS = 300;

export type TypePreview = { readonly kind: "loading" } | { readonly kind: "none" } | { readonly kind: "ready"; readonly parts: HoverParts };

/** The preview for `path` at `scopes` (the breadcrumbs'); undefined for a file
 * no language server here knows (no preview at all). */
export const useTypePreview = (path: string | undefined, scopes: ReadonlyArray<ScopeSymbol>): TypePreview | undefined => {
  const supported = path !== undefined && Language.languageOf(path) !== undefined;
  const text = useLiveFile(path ?? "")?.text;
  const anchor = React.useMemo(() => (text === undefined ? undefined : scopeAnchor(text, scopes)), [text, scopes]);
  const [preview, setPreview] = React.useState<TypePreview>({ kind: "loading" });
  React.useEffect(() => {
    if (!supported || path === undefined) return undefined;
    if (anchor === undefined) {
      setPreview({ kind: "none" });
      return undefined;
    }
    let cancelled = false;
    // What was shown stays until the new answer is in.
    const timer = setTimeout(() => {
      void hoverAt(path, anchor).then((info) => {
        if (cancelled) return;
        setPreview(Option.match(info, { onNone: () => ({ kind: "none" }), onSome: (found) => ({ kind: "ready", parts: hoverParts(found.markdown) }) }));
      });
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [supported, path, anchor]);
  return supported ? preview : undefined;
};
