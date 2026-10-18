/**
 * The parts of Elegoo's SDCP V3 protocol the printer page reads: the status
 * and attributes pushes, their codes, and the relay's `/api/state` reply.
 *
 * The printer and the relay send the same frames, so one parser serves both
 * connections. Field names are the firmware's own, typos included
 * (`ReleaseFilmMax`, `RelaseFilmState`).
 *
 * @internal
 */

/** The relay runs on the home server at this port (saturn-uploader `relay`). */
export const RELAY_PORT = 5197;

/** The printer's own WebSocket port and path. */
export const PRINTER_PORT = 3030;
export const PRINTER_WEBSOCKET_PATH = "/websocket";

export const CMD_STATUS = 0;
export const CMD_ATTRIBUTES = 1;

export interface PrintInfo {
  readonly Status?: number;
  readonly CurrentLayer?: number;
  readonly TotalLayer?: number;
  /** Milliseconds. */
  readonly CurrentTicks?: number;
  readonly TotalTicks?: number;
  readonly Filename?: string;
  readonly ErrorNumber?: number;
  readonly TaskId?: string;
}

export interface PrinterStatus {
  readonly CurrentStatus?: ReadonlyArray<number>;
  readonly PrintInfo?: PrintInfo;
  readonly TempOfUVLED?: number;
  readonly TempOfTank?: number;
  readonly TempTargetTank?: number;
  readonly ReleaseFilm?: number;
  readonly TimeLapseStatus?: number;
}

export interface PrinterAttributes {
  readonly Name?: string;
  readonly MachineName?: string;
  readonly FirmwareVersion?: string;
  readonly MainboardIP?: string;
  readonly MainboardID?: string;
  readonly Resolution?: string;
  readonly ReleaseFilmMax?: number;
  readonly CameraStatus?: number;
  readonly RemainingMemory?: number;
  readonly NumberOfVideoStreamConnected?: number;
  readonly MaximumVideoStreamAllowed?: number;
}

/** What the relay's `GET /api/state` returns (only the fields the page reads). */
export interface RelayState {
  readonly connection: "Connected" | "Connecting";
  readonly printer: {
    readonly name: string;
    readonly ip: string;
    readonly port: number;
    readonly mainboardId: string;
    readonly brandId: string;
    readonly firmwareVersion: string;
  };
  readonly print: {
    readonly taskId: string;
    readonly layerIndex: number;
    readonly urls: {
      readonly preview: string;
      readonly thumbnail: string;
      readonly layerTemplate: string;
    };
  } | null;
  readonly status: PrinterStatus | null;
  readonly attributes: PrinterAttributes | null;
}

/** One parsed frame from the printer or the relay. */
export type Frame =
  | { readonly kind: "status"; readonly status: PrinterStatus; readonly mainboardId: string | undefined }
  | { readonly kind: "attributes"; readonly attributes: PrinterAttributes; readonly brandId: string | undefined; readonly mainboardId: string | undefined }
  | { readonly kind: "notice"; readonly message: string }
  | { readonly kind: "response"; readonly cmd: number | undefined; readonly requestId: string; readonly ack: number | undefined }
  | { readonly kind: "other" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Parses one WebSocket text frame. `pong` and anything unreadable come back as "other". */
export const parseFrame = (text: string): Frame => {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return { kind: "other" };
  }
  if (!isRecord(message) || typeof message.Topic !== "string") return { kind: "other" };
  const mainboardId = typeof message.MainboardID === "string" ? message.MainboardID : undefined;
  if (message.Topic.startsWith("sdcp/status/") && isRecord(message.Status)) {
    return { kind: "status", status: message.Status as PrinterStatus, mainboardId };
  }
  if (message.Topic.startsWith("sdcp/attributes/") && isRecord(message.Attributes)) {
    return { kind: "attributes", attributes: message.Attributes as PrinterAttributes, brandId: typeof message.Id === "string" ? message.Id : undefined, mainboardId };
  }
  if (message.Topic.startsWith("sdcp/notice/") && isRecord(message.Data) && isRecord(message.Data.Data)) {
    return { kind: "notice", message: String(message.Data.Data.Message) };
  }
  if (message.Topic.startsWith("sdcp/response/") && isRecord(message.Data) && typeof message.Data.RequestID === "string") {
    const ack = isRecord(message.Data.Data) && typeof message.Data.Data.Ack === "number" ? message.Data.Data.Ack : undefined;
    return { kind: "response", cmd: typeof message.Data.Cmd === "number" ? message.Data.Cmd : undefined, requestId: message.Data.RequestID, ack };
  }
  return { kind: "other" };
};

export const CMD_PAUSE = 129;
export const CMD_STOP = 130;
export const CMD_RESUME = 131;
export type ControlCmd = typeof CMD_PAUSE | typeof CMD_STOP | typeof CMD_RESUME;

/** A pause, stop, or resume request. The printer replies on the response topic with the same request id. */
export const controlRequest = (cmd: ControlCmd, ids: { readonly brandId: string; readonly mainboardId: string }, requestId: string, nowMs: number): string =>
  JSON.stringify({
    Id: ids.brandId,
    Data: { Cmd: cmd, Data: {}, RequestID: requestId, MainboardID: ids.mainboardId, TimeStamp: Math.floor(nowMs / 1000), From: 3 },
    Topic: `sdcp/request/${ids.mainboardId}`,
  });

/** What an ack from a print control means (spec `sdcp_print_ctrl_ack_t`; -1 is the relay's "no answer"). */
export const controlAckLabel = (ack: number): string =>
  ack === 0 ? "OK" : ack === 1 ? "The printer is not in a state that allows this" : ack === -1 ? "The printer did not answer" : `Printer error ${ack}`;

export const PHASE_PAUSING = 5;
export const PHASE_PAUSED = 6;
export const PHASE_STOPPING = 7;

/** A status or attributes refresh request. */
export const refreshRequest = (cmd: typeof CMD_STATUS | typeof CMD_ATTRIBUTES, ids: { readonly brandId: string; readonly mainboardId: string }, requestId: string, nowMs: number): string =>
  JSON.stringify({
    Id: ids.brandId,
    Data: { Cmd: cmd, Data: {}, RequestID: requestId, MainboardID: ids.mainboardId, TimeStamp: Math.floor(nowMs / 1000), From: 3 },
    Topic: `sdcp/request/${ids.mainboardId}`,
  });

const MACHINE = ["Idle", "Printing", "Transferring", "Exposure test", "Device test"];
const PHASE = ["Idle", "Homing", "Dropping", "Exposing", "Lifting", "Pausing", "Paused", "Stopping", "Stopped", "Complete", "Checking file"];

export const machineLabel = (code: number): string => MACHINE[code] ?? `Code ${code}`;
export const phaseLabel = (code: number | undefined): string => (code === undefined ? "Idle" : PHASE[code] ?? `Status ${code}`);

export const PHASE_EXPOSING = 3;
export const PHASE_COMPLETE = 9;
export const MACHINE_PRINTING = 1;

/**
 * The zero-based layer on the LCD. The printer counts layers from 1 and moves
 * `CurrentLayer` on at the start of each layer, so during exposure the image
 * is `CurrentLayer - 1`. Matches the relay's `exposingLayerIndex`.
 */
export const layerIndexOf = (currentLayer: number, totalLayers: number): number => Math.min(Math.max(currentLayer - 1, 0), Math.max(totalLayers - 1, 0));

export const isPrinting = (status: PrinterStatus | undefined): boolean => (status?.CurrentStatus ?? []).includes(MACHINE_PRINTING);
