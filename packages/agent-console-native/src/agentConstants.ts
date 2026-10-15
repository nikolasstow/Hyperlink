/**
 * Kept in its own leaf module to avoid an import cycle (session lists use it).
 *
 * @internal
 */

/** Every session the app makes runs under the "console" agent (global
 * opencode config): edits allowed; shell commands and subagents ask. */
export const AGENT = "console";
