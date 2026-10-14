/**
 * What a session is called on screen. v2 names a session a moment after its
 * first message; until then (and for one never named) it shows this, never
 * a blank.
 *
 * @internal
 */

export const NEW_SESSION_TITLE = "New session";

/** `title`, or the placeholder when there is none yet. */
export const shownTitle = (title: string | undefined): string => (title === undefined || title.trim().length === 0 ? NEW_SESSION_TITLE : title);
