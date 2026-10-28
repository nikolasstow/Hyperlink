/**
 * The printer page's live link, shared with the pages it opens (Files,
 * Health, Settings: printer/PrinterPages.tsx). The printer takes only a few
 * connections, so those pages never open their own: the printer page holds
 * the one link (usePrinterLink.ts) and stays mounted under them on the
 * stack. It publishes each new state here, by server address.
 *
 * `usePrintRunning` answers "is a print running?" for any page with a Print
 * button: from this link when the printer page is open, and from the
 * relay's `GET /api/state` when it is not.
 *
 * The Measurements switch lives here too: Settings changes it and the
 * printer page's LCD shows it. It is remembered on the phone.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";
import { authedFetch } from "../auth/serverTokens";
import { isPrinting, type RelayState } from "./sdcp";
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

/** How often a page with no printer page under it asks the relay whether a print runs. */
const RUNNING_POLL_MS = 5000;

/** The printer page's link for a relay, while that page is open. */
const linkForRelay = (relayBase: string): PrinterLink | undefined => Array.from(links.values()).find((link) => link.relayBase === relayBase);

/**
 * Whether a print runs (or is paused) on the relay's printer. Undefined
 * until the app knows. A Print button stays off unless this is false; the
 * relay refuses a second print in any case.
 */
export const usePrintRunning = (relayBase: string): boolean | undefined => {
  const link = React.useSyncExternalStore(subscribe, () => linkForRelay(relayBase));
  const linked = link !== undefined;
  const [polled, setPolled] = React.useState<boolean | undefined>(undefined);
  React.useEffect(() => {
    if (linked) return;
    let alive = true;
    const tick = (): void => {
      authedFetch(`${relayBase}/api/state`, { cache: "no-store" })
        .then((response) => response.json())
        .then((state: RelayState) => {
          if (alive) setPolled(state.status === null ? undefined : isPrinting(state.status));
        })
        .catch((cause: unknown) => {
          console.error("[printer] asking the relay whether a print runs failed", cause);
          if (alive) setPolled(undefined);
        });
    };
    tick();
    const id = setInterval(tick, RUNNING_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [relayBase, linked]);
  if (link !== undefined) return link.status === undefined ? undefined : isPrinting(link.status);
  return polled;
};

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
