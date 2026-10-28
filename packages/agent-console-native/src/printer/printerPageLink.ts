/**
 * The printer page's live link, shared with the pages it opens (Files,
 * Health, Settings: printer/PrinterPages.tsx). The printer takes only a few
 * connections, so those pages never open their own: the printer page holds
 * the one link (usePrinterLink.ts) and stays mounted under them on the
 * stack. It publishes each new state here, by server address.
 *
 * The Measurements switch lives here too: Settings changes it and the
 * printer page's LCD shows it. It is remembered on the phone.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";
import type { PrinterLink } from "./usePrinterLink";

const links = new Map<string, PrinterLink>();
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Publishes the printer page's link for `serverAddress` while the page is mounted. */
export const usePublishPrinterLink = (serverAddress: string | undefined, link: PrinterLink): void => {
  React.useEffect(() => {
    if (serverAddress === undefined) return;
    links.set(serverAddress, link);
    notify();
  }, [serverAddress, link]);
  React.useEffect(
    () => () => {
      if (serverAddress === undefined) return;
      links.delete(serverAddress);
      notify();
    },
    [serverAddress],
  );
};

/** The printer page's link for `serverAddress`, while that page is open under this one. */
export const usePrinterPageLink = (serverAddress: string | undefined): PrinterLink | undefined =>
  React.useSyncExternalStore(subscribe, () => (serverAddress === undefined ? undefined : links.get(serverAddress)));

const MEASURE_KEY = "agent-console-native:printer:measure";
let measure = false;
let measureLoaded = false;

/** The Measurements switch, remembered on the phone. Off until the owner turns it on. */
export const useMeasure = (): readonly [boolean, (next: boolean) => void] => {
  React.useEffect(() => {
    if (measureLoaded) return;
    measureLoaded = true;
    AsyncStorage.getItem(MEASURE_KEY)
      .then((raw) => {
        if (raw === "1") {
          measure = true;
          notify();
        }
      })
      .catch((cause: unknown) => console.error("[printer] reading the Measurements switch failed", cause));
  }, []);
  const value = React.useSyncExternalStore(subscribe, () => measure);
  const change = React.useCallback((next: boolean) => {
    measure = next;
    notify();
    AsyncStorage.setItem(MEASURE_KEY, next ? "1" : "0").catch((cause: unknown) => console.error("[printer] keeping the Measurements switch failed", cause));
  }, []);
  return [value, change];
};
