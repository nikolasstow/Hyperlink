/**
 * Where the next pin shows, per collection page: the scope last chosen in the
 * pin toast, remembered on this device, so pinning goes where it went last.
 * Both until something is chosen.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PinScope } from "./pagesClient";

const storageKey = (page: string): string => `pinScope:${page}`;

let scopes: ReadonlyMap<string, PinScope> = new Map();

const isScope = (value: string | null): value is PinScope => value === "group" || value === "top" || value === "both";

/** The scope to pin with now. The saved one is read in the background the
 * first time; a pin made before it arrives goes to both. */
export const pinScopeFor = (page: string): PinScope => {
  const known = scopes.get(page);
  if (known !== undefined) return known;
  scopes = new Map([...scopes, [page, "both"]]);
  AsyncStorage.getItem(storageKey(page)).then(
    (saved) => {
      if (isScope(saved)) scopes = new Map([...scopes, [page, saved]]);
    },
    (error: unknown) => console.error(`[pin scope] reading the saved scope for ${page} failed`, error),
  );
  return "both";
};

/** Remember the scope chosen, for the next pin. */
export const rememberPinScope = (page: string, scope: PinScope): void => {
  scopes = new Map([...scopes, [page, scope]]);
  AsyncStorage.setItem(storageKey(page), scope).catch((error: unknown) => console.error(`[pin scope] saving the scope for ${page} failed`, error));
};

/** Read the saved scope ahead of the first pin. */
export const preloadPinScope = (page: string): void => {
  pinScopeFor(page);
};
