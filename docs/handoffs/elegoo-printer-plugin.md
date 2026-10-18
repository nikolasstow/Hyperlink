# Elegoo resin printer page (Saturn 4 Ultra 16K)

**Status:** working page, 2026-10-18. JavaScript only: every module the page uses is already in the app. Dev build `cf9744f5` (variant iota) finished on EAS; Metro for iota runs on :8083 (tmux `iota-metro`). Not yet seen on a device or a simulator.
**Scope:** a printer page under Servers (live print, layer image, controls, camera, file browser, uploads), a relay on the home server, and a web portal.
**Related:** [server-pages-and-widgets.md](./server-pages-and-widgets.md) · [double-agent-repo-screen-and-plugin-system.md](./double-agent-repo-screen-and-plugin-system.md) §22 · the relay lives in the separate repo `nikolasstow/saturn-uploader`, branch `feat/relay-portal`.

## 0. Confirm before acting

This handoff is not a go. Before you change code from it, list the concrete
actions you will take and wait for the owner to confirm them
(`confirm-handoff-actions` in [working-agreement.md](../standards/working-agreement.md)).

## 1. Review standards

Read [`docs/standards/`](../standards/) before you edit. The printer page
follows the app's screen code (`StyleSheet`, semicolons, compact JSX). Its
look is its own: glass cards (`CardGlass`) over a blurred backdrop of the
current print, with UV violet (`#8f73ff`) as the only accent. Do not copy the
UPS page's design (owner, 2026-10-18).

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

1. A client learns the printer's LAN address and ids once from the relay (`GET /api/state`, which does not touch the printer) and keeps them.
2. The client tries the printer directly, with a 2.5 s timeout.
3. On the LAN the app takes SDCP status directly from the printer's WebSocket.
4. Away from home (the direct try fails), the client uses the relay's `/websocket`.
5. Layer images, previews, the camera, files, and uploads always come from the relay. When the relay is unreachable on the LAN, the phone decodes layer images from the printer itself (`directLayers.ts`). The camera, files, and uploads then show that the relay is needed.
6. The relay opens its own printer connection only while a relay client is active, and closes it 60 s after the last one.

The web portal is loaded from the relay, and on the LAN it takes status
directly from the printer. The printer's file server sends no CORS headers,
so a browser cannot read print files without the relay.

## 3. What exists

### The relay (saturn-uploader, `feat/relay-portal`)

| File | Role |
|---|---|
| `src/Goo.ts` | Pure decoder for Elegoo `.goo` files: header, previews, layer definitions, layer RLE. Reduces while it decodes, so it never builds the 94-megapixel frame. |
| `src/LayerImages.ts` | Reads byte ranges of the print file from the printer's own HTTP file server, builds the layer offset table step by step, renders PNG (whole LCD, square pixels), caches 48 renders. |
| `src/Files.ts` | Pure helpers for the file browser: storage roots, media paths, path safety, upload names. |
| `src/RelayFiles.ts` | File list, file previews and info, and the upload queue (one upload at a time, paced while printing). |
| `src/Camera.ts` | One RTSP session to the printer's camera, shared by all viewers as H.264 and MJPEG. |
| `src/Relay.ts` | Routes, the status snapshot, polling, and prefetch of the current and next layer. |
| `portal/index.html` | The web portal. One file, no dependencies. Auto, Direct, and Relay modes. |
| `src/PrinterClient.ts` | Gains `subscribeRaw`, the printer's frames as unchanged text. |

Routes on port 5197 (the relay's README has the full table):

| Route | Returns |
|---|---|
| `GET /` | The portal. `/?view=camera` is the camera alone; add `&bare=1` for an embed with no controls. |
| `GET /websocket` | The printer's SDCP frames, fanned out. Cmd 0 and Cmd 1 are answered from the cache. Pause, stop, and resume (129, 130, 131) go to the printer and the client gets the printer's ack (`-1` if no answer). Every other command gets a notice and is not sent. |
| `GET /api/state` | Printer identity, connection, derived print view with image URLs, the raw status and attributes, and `relay.secureUrl`. |
| `GET /api/prints/:taskId` | File header summary (with the LCD size in mm) and how many layers are indexed. |
| `GET /api/prints/:taskId/layers/:index.png` | Layer image, the whole LCD with square pixels. Query: `scale` (default 8), `crop` (fit to the model, default 0), `mirror` (default 0), `alpha` (default 0). Cached forever by the client. |
| `GET /api/prints/:taskId/preview.png` | The slicer's 290 x 290 preview. |
| `GET /api/files?path=` | One folder of `/local/` or `/usb/`, with sizes, the printable flag, and the file being printed. |
| `GET /api/files/preview.png?path=` | A file's slicer preview (`&size=big` for the large one). |
| `GET /api/files/info?path=` | A file's header: layers, print time, resin, exposure settings, LCD size. |
| `POST /api/uploads?name=` | The raw file as the body. Returns 202 and a job id. Refuses unprintable types (415), the file being printed (409), and an existing name (409 with `exists: true`) unless `&overwrite=1`. |
| `GET /api/uploads` | The upload jobs and their stages: queued, hashing, sending, verifying, done, failed, cancelled. |
| `DELETE /api/uploads/:id` | Cancels an upload. |
| `GET /api/camera.h264` | The camera as H.264 over a WebSocket (secure pages only, for WebCodecs). |
| `GET /api/camera.mjpeg` | The camera as MJPEG. |

### The app (this worktree, `iota`, branch `feat/elegoo-printer-plugin`)

| File | Role |
|---|---|
| `src/printer/sdcp.ts` | Frame parser, labels, `layerIndexOf`, `printErrorLabel`, the refresh request. |
| `src/printer/usePrinterLink.ts` | The hook: direct first, then the relay. Keeps the printer identity in AsyncStorage. Checks the relay every 30 s, also while direct, and exposes `relayReachable` and `secureUrl`. Dials one way at a time. Reconnects on foreground. Sends Cmd 0 every 15 s. |
| `src/printer/relayApi.ts` | Typed calls to the relay: print header, file list, file info, previews, upload jobs, cancel, and `startUpload` (expo-file-system `UploadTask` with progress). |
| `src/printer/printerFormat.ts` | Pure formatting: durations, bytes, the print settings cells, the self-check items. |
| `src/printer/goo.ts` | The `.goo` decoder and a PNG writer (fflate), run on the phone. A port of the relay's `Goo.ts`, with `pixelAspect` and `stretchY` for square pixels. |
| `src/printer/directLayers.ts` | The fallback layer source (section 2, item 5): reads the print file from the printer in byte ranges, walks and saves the layer offset table (AsyncStorage, once per print), and decodes the whole LCD with square pixels. One request at a time. |
| `src/printer/ui.tsx` | The page's parts: colours, `Card` (glass), `Dot`, `Chip`, `Button`, `Row`, `Cells`. |
| `src/printer/PrinterStage.tsx` | The LCD at its real size in mm (10 mm grid, ruler, the layer tinted UV and glowing while exposing), the progress bar, and the controls (each behind an `Alert`). |
| `src/printer/PrinterCamera.tsx` | The camera: a WebView of the relay's `/?view=camera&bare=1`, mounted only while the owner watches, with a full-screen mode. It stops when the app goes to the background. |
| `src/printer/PrinterFiles.tsx` | The file browser: Printer and USB tabs, folders, thumbnails, a details sheet, Upload (DocumentPicker), and the upload queue. Upload rows live outside the page, so an upload goes on when the owner leaves and shows again on return; unfinished relay jobs from other devices show too. |
| `src/PrinterScreen.tsx` | The page: backdrop, title and chips, stage, camera, files, printer vitals, self-check, print settings. |
| `src/ServerScreen.tsx` | The Services row "Resin Printer" ("Live print, camera, and files"). |
| `src/RootNavigator.tsx` | Route `ServerPrinter: { serverName; serverAddress }`. |

Dependency added earlier: `fflate` 0.8.3 (pure JS). The redesign adds no
dependency.

The layer image is an alpha mask (`alpha=1` from the relay, or decoded on the
phone): white where the LCD is lit, transparent elsewhere. `Image`
`tintColor` colours it, and the iOS shadow on the wrapper follows the lit
shape, which makes the glow. Each image is the whole LCD, stretched to square
pixels, so every layer shows at one scale in real proportions.

## 4. Printer facts, measured on firmware V1.5.6

- The printer accepted two WebSocket clients at once, and both got every push. No subscribe command exists or is needed.
- The printer never answered the text `ping`. An idle printer can stay silent for longer than a heartbeat timeout, so clients ask for status every 15 s.
- While printing, the printer pushes on every sub-step: Dropping (here `CurrentLayer` goes up by one), Exposing about 0.5 s later, Lifting about 3 s later. One layer takes about 6 s.
- Port 3030 also runs an open HTTP file server (Mongoose 7.12). It serves files with `Range` support at `/media/mmcblk0p3/<name>` (onboard, `/local/`) or `/media/sda1/<name>` (USB, `/usb/`).
- That file server is slow for bulk data: about 100 KB/s. One layer image takes about 1.5 s to read. So the relay reads each layer once, renders one at a time, prefetches the current and next layer, and caches. A warm layer request takes 0.02 to 0.3 s.
- The 16K LCD's pixels are not square: about 14 x 19 µm (`pixelAspect` about 1.357). The `.goo` header gives the LCD size in mm.
- The file list (Cmd 258) gives names like `/local//part.goo` (two slashes) and no sizes. The relay fixes the path and reads each size from a `bytes=0-0` range request.
- Uploads go at about 0.5 MiB/s when idle. The printer takes about 14 s to accept the first packet, and the check after the last packet takes 10 to 20 s.
- The camera is RTSP on port 554 (Cmd 386 turns it on). The relay holds one session and shares it.
- The relay saves each file's offset table under `~/.cache/saturn-uploader`, so a restart does not walk the file again.

## 5. Run and verify

The relay reads `~/.config/saturn-uploader.json` on the Mac mini (printer
address, `relaySecureUrl`, upload pace). Run it from an SSH session or
Terminal (section 6):

```sh
cd ~/Coding/saturn-uploader
node dist/main.js relay --config ~/.config/saturn-uploader.json
```

Then open `http://100.67.32.32:5197/` in a browser, or
`https://nikolass-mac-mini.tail01c1c.ts.net:8443/` for the H.264 camera.

The app page needs no native change, so it rides Metro. Install the iota dev
build from EAS build `cf9744f5-c488-4f80-8c51-731744178b98`, open it, and
point it at Metro on `100.67.32.32:8083` (tmux `iota-metro`).

Open Home, then Servers, then Mac mini, then Resin Printer.

Verification, 2026-10-18: app `tsc` clean on both tsconfigs; eslint clean;
411 app tests pass in 52 files; `expo export --platform ios` succeeds. The
relay: typecheck and lint clean, 143 tests pass, including an end-to-end
upload against the fake printer. Live: the file list, previews, and info
work against the printer, and an upload through the portal finished and
passed the check. No simulator build was made: the Mac mini has no
CocoaPods.

## 6. Sharp edges

1. CAUTION: macOS Local Network privacy blocks the relay when it runs detached from a terminal (tmux, `nohup`, or a LaunchAgent). Connections then fail with `EHOSTUNREACH`. The fix is a LaunchDaemon, which the installer sets up. It asks for the password once:

   ```sh
   cd ~/Coding/saturn-uploader
   service/macos/install.sh ~/.config/saturn-uploader.json relay
   ```

   Until then, the relay runs only while an SSH session holds it, and nothing restarts it after a crash.
2. WARNING: the printer's file server on port 3030 has no login and exposes the whole filesystem to the LAN, including `/config/wpa_supplicant.conf` (the WiFi password). This is the firmware's behaviour, not ours. Keep the printer on a trusted network.
3. The layer numbering is an assumption: `CurrentLayer` counts from 1, so the LCD shows index `CurrentLayer - 1`. Check it at the end of a print. If the print finishes with `CurrentLayer == TotalLayer`, the assumption holds.
4. Only the current print's layers can be read through the relay. A request for another `TaskId` returns 404.
5. An upload during a print is not yet tested on the printer. The relay waits between packets while printing (`uploadPaceWhilePrinting`, 1.5 s) so the print gets the printer's attention first. Test it on a print that can fail before you trust it.
6. The camera allows few streams, and a client killed without RTSP TEARDOWN can hold a slot until a power cycle. The app never talks RTSP: it embeds the relay's page, which shares the relay's one session. Keep it that way.
7. Worktree variants drop the native extensions, so a printer Live Activity can only be tested on the base build (`pnpm build:master`).

## 7. DECISIONS

### 2026-10-17

1. The relay lives in `saturn-uploader`, not in this monorepo. It is printer software and reuses that repo's SDCP client. The app talks to it over HTTP only.
2. The relay passes on pause, stop, and resume, and nothing else (owner, 2026-10-17: controls must work remotely too). It never starts a print or deletes files.
3. The relay fans out unchanged frames, so direct and relay clients share one parser.
4. Superseded on 2026-10-18 (item 7): the app decoded layers itself on the LAN.
5. The app page is a bundled native screen under Servers, not a server-driven plugin page. The plugin system has no `requirement: "server"` or widget support yet.
6. The relay is lazy: no printer connection while no client uses it (owner: "I don't want a relay if it's not needed").

### 2026-10-18

7. Layer images come from the relay first, and the phone decodes them only when the relay is unreachable. The relay has each print's offset table walked and caches renders. Two readers on the printer's slow file server slow each other.
8. Every layer image is the whole LCD with square pixels (owner: "scale to the actual dimensions of the printer"). The LCD card uses the size in mm from the file header.
9. Uploads always land in `/local/`. The relay refuses the file being printed and asks before it replaces an existing name. Uploads run one at a time and wait between packets during a print (owner: an upload "shouldn't bother" a print).
10. The camera in the app is the relay's camera page in a WebView, not a native player.
11. No AI upscaling or deblur of the camera. The owner tried both and rejected them: "the artifacts make it worse than the real thing".

### Do not resurrect

- Downloading the whole print file to the relay. It is about 490 MB over the printer's WiFi, during a print.
- Matching a local file by name only. The Desktop copy of the running print had the same name and a different size: it was a different slice.
- Camera upscaling, frame interpolation, or deblur (decision 11).

## 8. Print controls and the Elegoo app

The page has Pause/Resume and Stop, each behind a confirmation, over either connection. Stop cannot be undone; pause takes about a minute to settle (the buttons wait while the printer is Pausing or Stopping).

The owner wants every control of Elegoo's iOS app, above all changing exposure and other print settings mid-print. Firmware analysis (V1.4.4B, from Elegoo's support site) found:

| Over the LAN (SDCP) | Only over Elegoo's cloud |
|---|---|
| 0, 1, 128 start, 129 pause, 130 stop, 131 resume, 192 rename, 255, 258 files, 259 delete, 320/321 history, 386 camera, 387 timelapse | 135 change print params (BottomExposureTime, BottomLayer, BottomRestTimeAfterDrop, BottomResetTimeBeforeLift, NormalExposureTime, NormalRestTimeAfterDrop, NormalResetTimeBeforeLift, TransitionLayer, LightOffTime), 134 motor move, 145 home, 146 motor stop, 151 light, 147/148 self-check |

Next steps for Cmd 135: check whether V1.5.6 (on the printer) accepts it over the LAN; if not, act as the official app against Elegoo's real cloud with the owner's account (capture the iOS app's traffic to learn login, tokens, and the send path). CAUTION: 135's exposure values are most likely seconds; sending milliseconds would expose each layer for half an hour. Never send unknown command numbers during a print: on some Elegoo firmware they crash the printer app.

## 9. Open questions

1. Install the relay as a LaunchDaemon on the Mac mini (section 6, item 1)? It needs the password once.
2. Delete files from the browser (Cmd 259)? It would change decision 2.
3. Start a print from the browser (Cmd 128)? It would change decision 2.
4. Should the relay also run the uploader's watch folder, so one service does both?
5. A Home widget for the printer (Phase 3 of server-pages-and-widgets)?
6. A Live Activity with layer progress? It needs the relay to send ActivityKit pushes through `activityPush.ts`, and the base build.

## 10. Build order

1. Owner looks at the page on a device.
2. Relay as a LaunchDaemon.
3. A mid-print upload test on a print that can fail.
4. Printer as the first user of the planned page and widget registries.
5. Live Activity on the base build.
