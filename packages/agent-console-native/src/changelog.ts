/**
 * The app's changelog: what the owner can now see or do, newest first. It
 * is kept here for good, in the repo; the phone keeps only the last version
 * the owner closed (ChangelogScreen.tsx).
 *
 * Add an entry with each change the owner can see. Give it the next
 * `version`, the date, and the commits it covers. Write each line as one
 * short sentence about what the owner sees or does.
 *
 * @internal
 */

export interface ChangelogEntry {
  /** Grows by one with each entry. The phone shows entries above the last version the owner closed. */
  readonly version: number;
  /** The day, as YYYY-MM-DD. */
  readonly date: string;
  readonly title: string;
  /** The commits on feat/elegoo-printer-plugin (or the branch named) that the entry covers. */
  readonly commits: ReadonlyArray<string>;
  readonly lines: ReadonlyArray<string>;
}

export const CHANGELOG: ReadonlyArray<ChangelogEntry> = [
  {
    version: 3,
    date: "2026-11-20",
    title: "Engine & Jobs, and the printer's state",
    commits: ["032ea5bec", "b44429213"],
    lines: [
      "Engine & Jobs shows the runs in progress on the MacBook, with their stage and time left.",
      "Below them you see the runs that ended last, with their burn and gate results, then the support jobs.",
      "The print card starts with the printer's state in words and colour.",
      "The printer pages use the standard iOS bar. The large title moves into the bar when you scroll.",
      "A list that is still loading shows \"…\", and a failed read shows \"!\" and the reason.",
    ],
  },
  {
    version: 2,
    date: "2026-11-20",
    title: "Live planner runs",
    commits: ["7ca29e3e5", "a3e8b704a"],
    lines: [
      "Runs starts with \"Running now\": each run in progress, its stage, and the minutes left.",
      "The Runs row on the printer page shows the run in progress, such as \"Run 640 · anti-alias · 4 min left\".",
      "Runs and Library open at once, also with hundreds of runs.",
      "Card titles are now headers above the cards.",
    ],
  },
  {
    version: 1,
    date: "2026-11-20",
    title: "A new printer page",
    commits: ["c1571c9d4", "1b64d4401", "be32e5df2", "6b266158c"],
    lines: [
      "The printer page shows the current print: the live layer, the progress, the time left, and the settings.",
      "Tap the print to open the print page: the stage, the controls, the 3D model, and how the file was made.",
      "The Printer card opens Details & health, Local files, Camera, Network, and Settings.",
      "The Resin card opens Runs, Library, Print history, and Engine & Jobs.",
      "Runs shows each run's checks, its settings against its parent, and its renders.",
      "Library shows print files by what they are. Print history shows every print with its outcome and notes.",
      "When the MacBook does not answer, the pages say \"MacBook unreachable\".",
    ],
  },
];

/** The entries newer than `lastSeen`, newest first. */
export const unseenEntries = (entries: ReadonlyArray<ChangelogEntry>, lastSeen: number | undefined): ReadonlyArray<ChangelogEntry> =>
  entries.filter((entry) => lastSeen === undefined || entry.version > lastSeen);

/** The newest version in the changelog. */
export const latestVersion = (entries: ReadonlyArray<ChangelogEntry>): number => entries.reduce((max, entry) => Math.max(max, entry.version), 0);
