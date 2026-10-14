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
   few minutes and shows a QR code with the code and the server's addresses (Tailscale included).
   In the app: Add Server → scan → the app redeems the code for its own device token. Typing the
   address and code works too.
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

- `server/auth/DeviceAuth.ts`: pairing codes (8 letters without look-alikes, 5 minutes, one
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
- `pnpm pair` (`server/pair.ts`): a code, the addresses (Tailscale first) and a QR code of
  `{ "code", "urls" }`.

Checked end to end on `:5298` against opencode v2 on `:4097`.

## Next: the app

Keychain (`expo-secure-store`) and the scanner (`expo-camera`) are new native modules, so a
build. Add Server: scan or type, redeem, keep the token per server. Every request: the token
on HTTP (the Effect clients, `fetch`, the event streams), a ticket for each WebSocket. A
devices list in settings with remove.
