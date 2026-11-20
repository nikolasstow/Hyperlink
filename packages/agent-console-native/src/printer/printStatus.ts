/**
 * The printer's state in a word, and the connection in a word, each with
 * its tone. The printer home, its header pill, and the print page share them.
 *
 * @internal
 */
import { isPrinting, PHASE_COMPLETE, PHASE_PAUSED, PHASE_PAUSING, PHASE_STOPPED, PHASE_STOPPING, printErrorLabel, type PrinterStatus } from "./sdcp";
import type { Tone } from "./ui";
import type { LinkState } from "./usePrinterLink";

export interface Labelled {
  readonly label: string;
  readonly tone: Tone;
}

export const linkChip = (link: LinkState): Labelled => {
  switch (link.kind) {
    case "Open":
      return link.via === "Direct" ? { label: "Direct", tone: "ok" } : { label: "Relay", tone: "uv" };
    case "Connecting":
      return { label: "Connecting", tone: "warn" };
    case "Offline":
      return { label: "Offline", tone: "bad" };
  }
};

/** The print's state in a word, with its tone. */
export const statusOf = (status: PrinterStatus | undefined, online: boolean): Labelled => {
  const info = status?.PrintInfo;
  const printing = isPrinting(status);
  if (!online) return { label: status === undefined ? "Connecting" : "Offline", tone: status === undefined ? "plain" : "bad" };
  if (info?.ErrorNumber !== undefined && info.ErrorNumber !== 0) return { label: printErrorLabel(info.ErrorNumber), tone: "bad" };
  if (info?.Filename === undefined || info.Filename === "") return { label: printing ? "Printing" : "Ready", tone: printing ? "uv" : "plain" };
  if (info.Status === PHASE_PAUSING) return { label: "Pausing", tone: "warn" };
  if (info.Status === PHASE_PAUSED) return { label: "Paused", tone: "warn" };
  if (info.Status === PHASE_STOPPING) return { label: "Stopping", tone: "warn" };
  if (printing) return { label: "Printing", tone: "uv" };
  if (info.Status === PHASE_COMPLETE) return { label: "Complete", tone: "ok" };
  if (info.Status === PHASE_STOPPED) return { label: "Stopped", tone: "plain" };
  return { label: "Ready", tone: "plain" };
};
