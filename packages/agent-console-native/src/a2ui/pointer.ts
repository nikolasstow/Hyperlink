/**
 * JSON Pointer (RFC 6901) get/set for the A2UI pilot's data model, plus the
 * resolver for `Dynamic<T>` bindings. Immutable set (returns a new object) so
 * React state updates are clean.
 *
 * @internal
 */
import type { Dynamic } from "./types";

const unescape = (token: string): string => token.replace(/~1/g, "/").replace(/~0/g, "~");

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Read the value at a JSON Pointer (e.g. `/user/name`); undefined if absent. */
export const getPointer = (data: unknown, pointer: string): unknown => {
  if (pointer === "") return data;
  const tokens = pointer.replace(/^\//, "").split("/").map(unescape);
  let current: unknown = data;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (isRecord(current)) {
      current = current[token];
    } else {
      return undefined;
    }
  }
  return current;
};

/** Return a copy of `data` with the value at `pointer` replaced. */
export const setPointer = (data: Record<string, unknown>, pointer: string, value: unknown): Record<string, unknown> => {
  const tokens = pointer.replace(/^\//, "").split("/").map(unescape);
  if (tokens.length === 0) return data;
  const [head, ...rest] = tokens;
  if (head === undefined) return data;
  if (rest.length === 0) return { ...data, [head]: value };
  const child = data[head];
  const nextChild = isRecord(child) ? child : {};
  return { ...data, [head]: setPointer(nextChild, `/${rest.join("/")}`, value) };
};

/** A binding is `{ "@path": "/..." }`; anything else is a literal. */
const isBinding = (value: unknown): value is { readonly "@path": string } => isRecord(value) && typeof value["@path"] === "string";

/** Resolve a `Dynamic<T>` against the data model — returns `unknown` (callers
 * coerce, e.g. `String(...)`), so there are no unchecked casts. */
export const resolveDynamic = <T>(value: Dynamic<T>, data: unknown): unknown => (isBinding(value) ? getPointer(data, value["@path"]) : value);

/** Resolve a dynamic value to a display string. */
export const resolveString = (value: Dynamic<string>, data: unknown): string => {
  const resolved = resolveDynamic(value, data);
  return resolved === undefined || resolved === null ? "" : String(resolved);
};
