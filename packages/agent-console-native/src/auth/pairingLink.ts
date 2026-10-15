/**
 * The pairing link `pnpm pair` shows as a QR code and prints
 * (`<scheme>://pair?code=…&url=…&url=…`): opened from the camera or a chat, it
 * brings the app up with the code and the server's addresses (Tailscale
 * first). Any scheme: the link only reaches this app through its own.
 *
 * @internal
 */

/** What a pairing link carries. */
export interface PairingLink {
  readonly code: string;
  readonly urls: ReadonlyArray<string>;
}

/** An http(s) address: scheme, host, optional port and path. */
const HTTP_ADDRESS = /^https?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/i;

/** `<scheme>://pair?…` or `<scheme>:///pair?…`: the query. Parsed by hand,
 * since React Native's `URL` reads only http(s) URLs fully. */
const PAIR_LINK = /^[a-z][a-z0-9+.-]*:\/\/\/?pair\/?\?(.*)$/i;

/** The pairing in `link`, if it is a pairing link with a code and an address. */
export const parsePairingLink = (link: string): PairingLink | undefined => {
  const query = PAIR_LINK.exec(link.trim())?.[1];
  if (query === undefined) return undefined;
  const params = new URLSearchParams(query);
  const code = params.get("code")?.trim() ?? "";
  const urls = params.getAll("url").filter((address) => HTTP_ADDRESS.test(address));
  return code.length === 0 || urls.length === 0 ? undefined : { code, urls };
};
