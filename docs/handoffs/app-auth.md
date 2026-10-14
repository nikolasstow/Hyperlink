# App auth

Started 2026-10-14 (owner + Claude, eta). Until now the API server (`packages/agent-console`,
`:5199`) answered anyone who could reach it over Tailscale or the LAN, and the app sent nothing.
opencode v2 also requires a password now (see `slash-commands.md`).

## Locked (owner approved the whole design, 2026-10-14)

1. **The API server is the one gate.** The app talks only to the API server, so every HTTP route
   and every WebSocket needs a device token there. opencode's password stays on the Mac: the
   server adds it when it forwards `/opencode/*`, and drops the app's own `Authorization`. The
   phone never sees opencode's password.
2. **Pairing, like opencode's.** `pnpm pair` on the Mac makes a single-use code that expires in a
   few minutes and shows a QR code of a pairing link. Scanned with the iPhone's own camera, it
   opens the app (no scanner in the app; owner, 10-14), which shows the server and asks before it
   redeems the code for its own device token. Typing the address and code in Add Server works
   too.
3. **Tokens per device, both ends.**
   - Phone: the token in the iOS Keychain, readable after first unlock (the background drain and
     Live Activities still work).
   - Server: only a hash of each token, with the device's name and when it was last seen. A
     device list in settings can remove one.
   - A token belongs to one server (multi-server ready).
4. **Sent on every request.** `Authorization: Bearer <token>` on HTTP. A WebSocket first asks for a
   short-lived, single-use ticket and passes it in the URL (as opencode does for terminals).
5. **What stays open.** `/health` and redeeming a pairing code. Local tools (such as `pnpm pair`)
   use an admin token from a file only the Mac's user can read, not an exemption for local calls
   (opencode v2 does not exempt them either).

## Built: server (2026-10-14, branch `feat/app-auth` on `chore/effect-4`)

- `server/auth/DeviceAuth.ts`: pairing codes (8 letters without look-alikes, 20 minutes, one
  use), device tokens (32 random bytes, kept as SHA-256 in `devices.json`, `0600`), WebSocket
  tickets (30 seconds, one use), the admin token (`admin-token`, `0600`, made at first start).
  Every token is compared by hash.
- `server/auth/http.ts`: the global gate (`Authorization: Bearer`, or `?ticket=`; open:
  `/health`, `/auth/redeem`, CORS preflight), and the `auth` API group: `POST /auth/pair`
  (admin), `POST /auth/redeem` (open), `GET /auth/devices`, `POST /auth/revoke`,
  `POST /auth/ticket` (device).
- `server/opencodeServer.ts`: opencode's address and password
  (`AGENT_CONSOLE_OPENCODE_PASSWORD`); the proxy and the file hub send it, and the proxy drops
  the app's `authorization` and `ticket`.
- `pnpm pair` (`server/pair.ts`): a QR code of `<scheme>://pair?code=…&url=…&url=…` (addresses
  Tailscale first), for the app built from the same worktree (`appScheme` in the native
  package's `variant.js`, shared with `app.config.js`; `APP_VARIANT=<name>` for another
  variant), plus the code and addresses to type.

Checked end to end on `:5298` against opencode v2 on `:4097`.

## Built: app (2026-10-14, eta)

- `src/auth/SecretStore.ts` + `secretStoreNative.ts`: the Keychain (`expo-secure-store`,
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), loaded only when its native module is in the build;
  an older build reports it unavailable and pairing asks for a new build.
- `src/auth/ServerAuth.ts`: pairs at the first address that answers `/health`, redeems the code
  as this phone (`deviceInfo().name`), keeps the token in the Keychain and the paired servers in
  `KeyValueStore`, reads them back at launch (before the first connection), lists each server's
  devices (at launch and on return to the foreground) and revokes them.
- `src/auth/serverTokens.ts`: the tokens by origin, and the only way a request gets one:
  the Effect clients (`FetchHttpClient.Fetch`), the opencode SDK, `authedFetch` for every plain
  `fetch`, `authHeaders` for downloads. Unpaired servers get no token and work as before.
- The file-sync WebSocket asks for a ticket for each connection.
- `App.tsx`: a pairing link (`<scheme>://pair?code=…&url=…`, `auth/pairingLink.ts`) shows
  "Pair this phone?" with the server, then pairs and connects; the server setup screen takes a
  pairing code; a server that answers 401 says to pair.
- Settings → Paired devices: each device, "This phone", Remove (asks first; removing this phone
  goes back to choosing a server).

## Rolling out

1. Install the build with the Keychain module.
2. Restart eta's API server (`:5299`) on this code: it then asks every app for a token.
3. Claude runs `pnpm pair` there and sends the link in the chat; tap it, then Pair.
