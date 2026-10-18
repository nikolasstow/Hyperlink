# Elegoo resin printer page (Saturn 4 Ultra 16K)

**Status:** prototype, built 2026-10-17. JavaScript only. Not yet seen on a device.
**Scope:** a read-only printer page under Servers, a relay on the home server, and a web portal.
**Related:** [server-pages-and-widgets.md](./server-pages-and-widgets.md) · [double-agent-repo-screen-and-plugin-system.md](./double-agent-repo-screen-and-plugin-system.md) §22 · the relay lives in the separate repo `nikolasstow/saturn-uploader`, branch `feat/relay-portal`.

## 0. Confirm before acting

This handoff is not a go. Before you change code from it, list the concrete
actions you will take and wait for the owner to confirm them
(`confirm-handoff-actions` in [working-agreement.md](../standards/working-agreement.md)).

## 1. Review standards

Read [`docs/standards/`](../standards/) before you edit. This page follows the
app's existing screen code (one `StyleSheet`, semicolons, compact JSX) the same
way `ServerUpsScreen.tsx` does.

## 2. The model: three clients, two paths, one protocol

The printer speaks SDCP V3 over a WebSocket on port 3030. The relay on the
home server opens one connection to the printer and serves the same frames
to any number of clients. So every client uses one parser, and only the URL
changes between the two paths.

```
   phone (DoubleAgent)  ─┐                      ┌─ ws://192.168.1.31:3030/websocket
   desktop (portal)     ─┼─ Direct (on the LAN) ─┤      the printer
   iPad (portal)        ─┤                      │
                         └─ Relay (Tailscale) ──┴─ http://100.67.32.32:5197
                                                       the relay on the Mac mini
```

1. A client asks the relay `GET /api/state` for the printer's LAN address and ids.
2. The client tries the printer directly, with a 2.5 s timeout.
3. If that fails (the phone is away from home), the client uses the relay's `/websocket`.
4. Layer images always come from the relay, because only the relay can read and decode the print file.

## 3. What exists

### The relay (saturn-uploader, `feat/relay-portal`)

| File | Role |
|---|---|
| `src/Goo.ts` | Pure decoder for Elegoo `.goo` files: header, previews, layer definitions, layer RLE. Reduces while it decodes, so it never builds the 94-megapixel frame. |
| `src/LayerImages.ts` | Reads byte ranges of the print file from the printer's own HTTP file server, builds the layer offset table step by step, renders PNG, caches 48 renders. |
| `src/Relay.ts` | Routes, the status snapshot, polling, and prefetch of the current and next layer. |
| `portal/index.html` | The web portal. One file, no dependencies. Auto, Direct, and Relay modes. |
| `src/PrinterClient.ts` | Gains `subscribeRaw`, the printer's frames as unchanged text. |

Routes on port 5197:

| Route | Returns |
|---|---|
| `GET /` | The portal. |
| `GET /websocket` | The printer's SDCP frames, fanned out. Read-only: Cmd 0 and Cmd 1 are answered from the cache; every other command gets a notice and is not sent. |
| `GET /api/state` | Printer identity, connection, derived print view with image URLs, and the raw status and attributes. |
| `GET /api/prints/:taskId` | File header summary and how many layers are indexed. |
| `GET /api/prints/:taskId/layers/:index.png` | Layer image. Query: `scale` (default 8), `crop` (default 1), `mirror` (default 0), `alpha` (default 0). Cached forever by the client. |
| `GET /api/prints/:taskId/preview.png` | The slicer's 290 x 290 preview. |
| `GET /api/prints/:taskId/thumbnail.bmp` | The printer's 400 x 300 task thumbnail, proxied. |

### The app (this worktree, `iota`, branch `feat/elegoo-printer-plugin`)

| File | Role |
|---|---|
| `src/printer/sdcp.ts` | Frame parser, labels, `layerIndexOf`, the refresh request. |
| `src/printer/usePrinterLink.ts` | The hook: direct first, then the relay. Keeps the printer identity in AsyncStorage. Reconnects on foreground. Sends Cmd 0 every 15 s. |
| `src/PrinterScreen.tsx` | The page: the LCD card with the layer tinted UV violet (it glows while exposing), progress, stats, thumbnails, printer facts. |
| `src/ServerScreen.tsx` | New Services row "Resin Printer". |
| `src/RootNavigator.tsx` | New route `ServerPrinter: { serverName; serverAddress }`. |

The layer image in the app is an alpha mask (`alpha=1`): white where the LCD
is lit, transparent elsewhere. `Image` `tintColor` colours it, and the iOS
shadow on the wrapper follows the lit shape, which makes the glow.

## 4. Printer facts, measured on firmware V1.5.6

- The printer accepted two WebSocket clients at once, and both got every push. No subscribe command exists or is needed.
- The printer never answered the text `ping`. An idle printer can stay silent for longer than a heartbeat timeout, so clients ask for status every 15 s.
- While printing, the printer pushes on every sub-step: Dropping (here `CurrentLayer` goes up by one), Exposing about 0.5 s later, Lifting about 3 s later. One layer takes about 6 s.
- Port 3030 also runs an open HTTP file server (Mongoose 7.12). It serves the print file with `Range` support at `/media/mmcblk0p3/<name>` (onboard) or `/media/sda1/<name>` (USB). The relay reads the header once, then 70 bytes per layer to find offsets (about 8 ms each over WiFi), then about 150 KB per layer image.
- Task thumbnails are at `/media/mmcblk0p1/history_image/<TaskId>.bmp`, named by the `TaskId` in every status push.
- The printer has a camera (RTSP on port 554, Cmd 386). The prototype does not use it.

## 5. Run and verify

Run the relay on the Mac mini (from an SSH session or Terminal; see section 6):

```sh
cd ~/Coding/saturn-uploader
SATURN_PRINTER_IP=192.168.1.31 node dist/main.js relay
```

Then open `http://100.67.32.32:5197/` in a browser. Check `GET /api/state`
for `"connection": "Connected"`.

The app page needs no native change, so it rides Metro. This worktree's
variant (`DoubleAgent · iota`) has no build yet. To see the page, do one of
these:

1. Run `pnpm build:dev` here (metered EAS build), then Metro on a free port, for example `pnpm start --port 8083`.
2. Or merge this branch into the epsilon worktree and reload its dev client.

Open Home, then Servers, then Mac mini, then Resin Printer.

Verification so far: app `tsc` exit 0; eslint 0 errors on the changed files;
395 app tests pass (6 new). The relay: typecheck and lint clean, 118 tests
pass (13 new), and it served live layers of a running print through
Tailscale.

## 6. Sharp edges

1. CAUTION: macOS Local Network privacy blocks the relay when it runs detached from a terminal (tmux, `nohup`, or a LaunchAgent). Connections then fail with `EHOSTUNREACH`. The fix is to install it as a LaunchDaemon (root), which needs `sudo` once. The repo's `service/macos` folder has the pattern for the uploader. Until then, the relay runs only while an SSH session holds it.
2. WARNING: the printer's file server on port 3030 has no login and exposes the whole filesystem to the LAN, including `/config/wpa_supplicant.conf` (the WiFi password). This is the firmware's behaviour, not ours. Keep the printer on a trusted network.
3. The layer numbering is an assumption: `CurrentLayer` counts from 1, so the LCD shows index `CurrentLayer - 1`. Check it at the end of a print. If the print finishes with `CurrentLayer == TotalLayer`, the assumption holds.
4. Only the current print can be read through the relay. A request for another `TaskId` returns 404.
5. A first request for a late layer after a relay restart walks the offset table from layer 0 first (about 8 ms per layer, so about 40 s at layer 5000). The relay prefetches the current print's offsets as soon as it starts, so this is rare.
6. Worktree variants drop the native extensions, so a printer Live Activity can only be tested on the base build (`pnpm build:master`).
7. The camera allows few streams, and a client killed without RTSP TEARDOWN can hold a slot until a power cycle. Do not add camera code that can leak a stream.

## 7. DECISIONS, 2026-10-17

1. The relay lives in `saturn-uploader`, not in this monorepo. It is printer software and reuses that repo's SDCP client. The app talks to it over HTTP only.
2. The relay is read-only. It never forwards a command that could change a print.
3. The relay fans out unchanged frames, so direct and relay clients share one parser.
4. Layer images are decoded on the relay from Range reads of the printer's file server. A local copy is used only when its name and size match.
5. The app page is a bundled native screen under Servers, the UPS pattern, not a server-driven plugin page. The plugin system has no `requirement: "server"` or widget support yet.

### Do not resurrect

- Downloading the whole print file to the relay. It is about 490 MB over the printer's WiFi, during a print.
- Matching a local file by name only. The Desktop copy of the running print had the same name and a different size: it was a different slice.

## 8. Open questions

1. Install the relay as a LaunchDaemon on the Mac mini? It needs `sudo` once.
2. Should the relay also run the uploader's watch folder, so one service does both?
3. A Home widget for the printer (Phase 3 of server-pages-and-widgets)?
4. A Live Activity with layer progress? It needs the relay to send ActivityKit pushes through `activityPush.ts`, and the base build.
5. The camera: an MJPEG or HLS proxy in the relay (one ffmpeg, stopped with SIGTERM)?

## 9. Build order

1. Owner looks at the page on a device and decides on the open questions.
2. Relay as a LaunchDaemon.
3. Printer as the first user of the planned page and widget registries.
4. Live Activity on the base build.
5. Camera.
