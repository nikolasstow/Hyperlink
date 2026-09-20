/**
 * Bridges the local theme (theme.tsx, device storage) to the server's synced
 * config so multiple devices match: pulls `config.theme` on launch and applies
 * it, then pushes every local change back. Mounted inside AppContext (it needs
 * the server address), renders nothing.
 *
 * Last-write-wins: whoever changed a colour most recently wins on the next
 * launch. Good enough — there's no concurrent-edit story to resolve here.
 *
 * @internal
 */
import * as React from "react";
import { useAppContext } from "./AppContext";
import { getRemoteConfig, putRemoteConfig } from "./extensionsClient";
import { getApiAddress, parseTheme } from "./settings";
import { useTheme } from "./theme";

export const ThemeSync = (): null => {
  const { theme, setTheme } = useTheme();
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  const hydrated = React.useRef(false);

  // Pull the server's theme on launch (and if the server changes).
  React.useEffect(() => {
    let cancelled = false;
    getRemoteConfig(apiBase)
      .then((config) => {
        if (cancelled) return;
        const remote = parseTheme(config.theme);
        if (remote !== undefined) setTheme(remote);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) hydrated.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, setTheme]);

  // Push local changes up — only after the initial pull, so we don't overwrite
  // the server with the default before we've read it.
  React.useEffect(() => {
    if (!hydrated.current) return;
    void putRemoteConfig(apiBase, { theme }).catch(() => undefined);
  }, [theme, apiBase]);

  return null;
};
