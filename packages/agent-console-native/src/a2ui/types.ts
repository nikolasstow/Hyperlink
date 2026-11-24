/**
 * A2UI pilot — a small, faithful subset of Google's A2UI v1.0 model, enough to
 * prove the mapping onto DA's own glass components. A2UI's idea: the agent
 * describes a surface as data (a flat component map + a data model bound by
 * JSON Pointer); the HOST draws it with its OWN components ("brand sovereignty")
 * and streams user actions back on a `surfaceId`. DA already does this privately
 * (the plugin PageBlock system, `pagesClient.ts`); this module renders the OPEN
 * shape instead, so one surface can prove the fit.
 *
 * Pilot scope: a STATIC surface (no streamed updates yet) — a component map, a
 * root, and a data model. Streaming (`updateComponents`/`updateDataModel`) and
 * a server/opencode adapter come after the look is confirmed. See
 * docs/handoffs/a2ui-for-da.md.
 *
 * @internal
 */

/** A value that is either a literal or a data-model binding (JSON Pointer,
 * RFC 6901) — A2UI's `DynamicString`/`DynamicNumber` idea, pared down. */
export type Dynamic<T> = T | { readonly "@path": string };

/** An event streamed back to the agent when a control fires (A2UI `action`). */
export interface A2uiAction {
  readonly name: string;
  /** Extra context the host attaches (A2UI puts the bound data here). */
  readonly context?: Readonly<Record<string, unknown>>;
}

/** The pilot's component catalog — A2UI core primitives DA can draw with its
 * glass components. Each has a unique `id` and a `component` type (adjacency
 * model: containers reference children by id). */
export type A2uiComponent =
  | { readonly id: string; readonly component: "Text"; readonly text: Dynamic<string>; readonly role?: "title" | "label" | "value" | "caption" }
  | { readonly id: string; readonly component: "Column"; readonly children: ReadonlyArray<string> }
  | { readonly id: string; readonly component: "Row"; readonly children: ReadonlyArray<string> }
  | { readonly id: string; readonly component: "Card"; readonly title?: Dynamic<string>; readonly children: ReadonlyArray<string> }
  | { readonly id: string; readonly component: "List"; readonly children: ReadonlyArray<string> }
  | { readonly id: string; readonly component: "Divider" }
  | {
      readonly id: string;
      readonly component: "Button";
      readonly label: Dynamic<string>;
      readonly action: A2uiAction;
      readonly destructive?: boolean;
    }
  | {
      readonly id: string;
      readonly component: "TextField";
      readonly label?: string;
      /** JSON Pointer into the data model — two-way bound. */
      readonly path: string;
      readonly placeholder?: string;
    }
  | {
      readonly id: string;
      readonly component: "ChoicePicker";
      readonly label?: string;
      readonly path: string;
      readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
    };

/** A rendered region: the component map, its root id, and the bound data. */
export interface A2uiSurfaceData {
  readonly version: "1.0";
  readonly surfaceId: string;
  readonly root: string;
  readonly components: Readonly<Record<string, A2uiComponent>>;
  readonly dataModel: Readonly<Record<string, unknown>>;
}
