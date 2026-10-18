/**
 * Formatting for the printer page: durations, sizes, a print file's
 * settings, and the printer's self-check. Pure, so it is easy to test.
 *
 * @internal
 */
import type { PrintHeader } from "./relayApi";

/** The LCD of a Saturn 4 Ultra 16K, for before the print file's header has arrived. */
export const DEFAULT_LCD_MM = { width: 211.68, height: 118.37 } as const;

/** The printer prints these; the relay refuses the rest. */
export const isPrintableName = (name: string): boolean => /\.(goo|ctb)$/i.test(name);

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const fmtDuration = (ms: number | undefined): string => {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
};

export const fmtBytes = (n: number | undefined): string =>
  n === undefined ? "" : n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`;

/** A print file's settings as label and value pairs, for a grid. `wide` cells span both columns. */
export const settingsCells = (h: PrintHeader): ReadonlyArray<{ readonly label: string; readonly value: string; readonly wide?: boolean }> => [
  { label: "Layer height", value: `${Math.round(h.layerHeightMm * 1000)} µm` },
  { label: "Layers", value: `${h.layerCount.toLocaleString()} · ${(h.layerCount * h.layerHeightMm).toFixed(1)} mm` },
  { label: "Exposure", value: `${h.exposureSeconds} s` },
  { label: "Bottom", value: `${h.bottomExposureSeconds} s × ${h.bottomLayerCount}` },
  { label: "Transition", value: `${h.transitionLayerCount} layers` },
  { label: "Anti-aliasing", value: h.antiAliasing > 0 ? `${h.antiAliasing}×` : "Off" },
  { label: "Resin", value: `${h.volumeMl.toFixed(1)} ml · ${h.materialGrams.toFixed(0)} g` },
  { label: "Estimated", value: fmtDuration(h.printSeconds * 1000) },
  { label: "Sliced with", value: `${h.softwareName} ${h.softwareVersion}`.trim(), wide: true },
  { label: "Created", value: h.createdAt, wide: true },
];

const HEALTH: ReadonlyArray<readonly [string, string]> = [
  ["LCDStatus", "LCD screen"],
  ["TempSensorStatusOfUVLED", "UV LED sensor"],
  ["ZMotorStatus", "Z motor"],
  ["RotateMotorStatus", "Rotary motor"],
  ["SgStatus", "Force sensor"],
  ["TankStatus", "Resin tank"],
  ["RelaseFilmState", "Release film"],
];

/** The printer's self-check, in a fixed order. Every field reports 1 for normal. */
export const healthItems = (devices: Readonly<Record<string, number>> | undefined): ReadonlyArray<{ readonly label: string; readonly ok: boolean }> =>
  devices === undefined ? [] : HEALTH.filter(([key]) => key in devices).map(([key, label]) => ({ label, ok: devices[key] === 1 }));
