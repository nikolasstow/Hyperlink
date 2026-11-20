/**
 * The current print file's header from the relay (the LCD's real size and
 * the print settings), kept on the phone by task id. The printer home
 * loads it when it opens, so the print page has it at once.
 *
 * @internal
 */
import * as React from "react";
import { fetchPrintHeader, type PrintHeader } from "./relayApi";

const headers = new Map<string, PrintHeader>();
const errors = new Map<string, string>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** A print's header, once the relay has given it. A failed read gives its reason; the page asks again when it opens again or the relay comes back. */
export const usePrintHeader = (relayBase: string, taskId: string | undefined, reachable: boolean): { readonly header: PrintHeader | undefined; readonly error: string | undefined } => {
  const key = taskId === undefined ? undefined : `${relayBase}#${taskId}`;
  React.useEffect(() => {
    if (key === undefined || taskId === undefined || !reachable || headers.has(key) || loading.has(key)) return;
    loading.add(key);
    fetchPrintHeader(relayBase, taskId)
      .then((header) => {
        headers.set(key, header);
        errors.delete(key);
      })
      .catch((cause: unknown) => {
        console.error("[printer] reading the print header failed", cause);
        errors.set(key, cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        loading.delete(key);
        notify();
      });
  }, [relayBase, taskId, reachable, key]);
  const header = React.useSyncExternalStore(subscribe, () => (key === undefined ? undefined : headers.get(key)));
  const error = React.useSyncExternalStore(subscribe, () => (key === undefined ? undefined : errors.get(key)));
  return { header, error };
};
