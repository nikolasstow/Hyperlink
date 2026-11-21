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
    version: 10,
    date: "2026-11-20",
    title: "Select any support in plan review",
    commits: ["saturn-uploader 17e1f38"],
    lines: [
      "Tap any part of a support (tip, cone, neck, stem, leg, brace, column, or base) to select it, in 3D or on the cut.",
      "The support card shows the tree, its position ID, the part you tapped, and that part's position ID.",
      "When more than one support is under your finger, a short list asks which one.",
      "In 3D the whole selected support shows in blue, through the model.",
      "A note or a requirement is saved with the position ID of the part you tapped.",
    ],
  },
  {
    version: 9,
    date: "2026-11-20",
    title: "Typing in the plan review",
    commits: ["feat/elegoo-printer-plugin: the keyboard fix"],
    lines: [
      "The plan review and the printer pages scroll the text you type above the keyboard.",
      "Drag the page down to close the keyboard.",
    ],
  },
  {
    version: 8,
    date: "2026-11-20",
    title: "Plan review on the phone",
    commits: ["feat/elegoo-printer-plugin: the run page fix"],
    lines: [
      "A run's page on the phone now shows \"Review the plan\" and the requirements the run meets.",
    ],
  },
  {
    version: 7,
    date: "2026-11-20",
    title: "Plan review",
    commits: ["saturn-uploader d5d380d"],
    lines: [
      "A run's page and the task page open the plan review: \"Review the plan\".",
      "You see the model and the plan's supports in 3D, with every triangle.",
      "The slider cuts the plan at any height: the model grey, the supports orange.",
      "Tap a support on the cut or in 3D to see its position ID, tree, tip, neck, stem, and load.",
      "Under it you can add a note or a requirement for that support. It is saved with the position ID and the run.",
      "Requirements and notes that name a position show as red rings on the cut and as marks in 3D.",
      "The 3D supports, the marks, and taps in 3D need the next app build. The cut works now.",
    ],
  },
  {
    version: 6,
    date: "2026-11-20",
    title: "Requirement checks for each head",
    commits: ["saturn-uploader 1bd2e33"],
    lines: [
      "Each requirement shows its newest check for head A and for head B, with what the check measured.",
      "A requirement's status follows its checks: failed when a head fails it, met when every head meets it.",
      "The task page lists every check ever made, newest first.",
      "A run's page shows the requirements that run met or failed, for each head.",
    ],
  },
  {
    version: 5,
    date: "2026-11-20",
    title: "Projects and tasks",
    commits: ["saturn-uploader f2b7880", "rundb.py project and task"],
    lines: [
      "Prints are now organized as projects and tasks. Beast is a project, and the Head is its current task.",
      "The Resin card shows the current task, how many of its requirements are met, and its run in progress or last print.",
      "Below it you see Beast's other tasks: Torso, Legs and feet, Arms and hands, and Bases.",
      "A task's page shows its requirements, prints, notes, runs, and library files.",
    ],
  },
  {
    version: 4,
    date: "2026-11-20",
    title: "The Beast head's history",
    commits: ["saturn-uploader 03dd60b", "rundb.py note and req"],
    lines: [
      "The Resin card has a Beast head page.",
      "At the top you see the requirements for the next print, each with its status and the run that shows it.",
      "Below them you see prints P1 to P8 with their outcomes and your notes, then the runs since the last print.",
      "A run's page shows which requirements it meets or fails.",
    ],
  },
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
