# opencode v2 cutover (shared servers)

The app and the agent-console server speak opencode **v2 only** (branch
`feat/live-file-sync`, eta). The shared servers still run v1. This is what
moving them takes. Do it only with the owner's go, after epsilon has merged
eta.

## What is true now

| Port | What | Runs from |
| --- | --- | --- |
| :4096 | opencode **v1** (patched: `POST /provider/refresh`), no password, `0.0.0.0` | `~/Coding/opencode` build, tmux `opencode-serve`, data `~/.local/share/opencode` |
| :5199 | agent-console API (`pnpm serve`) | epsilon `packages/agent-console` |
| :5195 | vite backend (push notifications: `notificationsPlugin`) | epsilon `packages/agent-console` |
| :4097 | opencode **v2** for eta, own data copy | `~/Coding/opencode-v2` build, tmux `eta-opencode`, home `~/Coding/opencode-v2-home` |

## What v2 changes

- **History moves by itself.** On first start against a data folder with v1
  sessions, v2 migrates them into its own tables
  (`GET /api/experimental/migration/v1` → `completed`). Rehearsed
  2026-10-14 on a copy of `~/.local/share/opencode`: 238 of 238 sessions,
  messages and answers intact.
- **After that, v1 must not run on that folder again.** Back it up first.
- **Password.** v2 serves with `OPENCODE_SERVER_PASSWORD` (Basic, user
  `opencode`). Every server that calls it needs
  `AGENT_CONSOLE_OPENCODE_PASSWORD` set to the same value (:5199 API and
  the :5195 vite backend).
- **opencode account.** v2 keeps its own login. Without it only the free
  opencode models exist and a session on a Claude model fails
  (`Model unavailable`). Connect it once with the device flow:
  `POST /api/integration/opencode/connect/oauth {"methodID":"device"}`,
  owner opens the returned URL, poll
  `GET /api/integration/opencode/connect/oauth/:attemptID` until
  `complete`. Expect to need this: eta's v2 had v1's account row copied in
  and still had no Claude models until the device login. Check
  `GET /api/model` for `claude-*` under `opencode`.
- **No provider refresh.** v2 has no `/provider/refresh`; the app's model
  reload just fetches the list again.

## Steps

1. Freeze epsilon and theta. Epsilon merges eta; full typecheck, tests,
   `pnpm install`.
2. Start an EAS build for each variant (the auth work added native
   modules: Keychain, device info).
3. Stop v1 (:4096). Back up `~/.local/share/opencode` (copy the folder;
   copy `opencode.db` with `sqlite3 … ".backup …"`).
4. Pick a password; start v2 on :4096 against the real data:
   `OPENCODE_SERVER_PASSWORD=… ~/Coding/opencode-v2/packages/cli/dist/cli-darwin-arm64/bin/opencode serve --hostname 0.0.0.0 --port 4096`
   (default XDG folders = the real data). Wait for migration `completed`.
5. Device login for the opencode account (see above); confirm `claude-*`
   in `GET /api/model`.
6. Restart :5199 and :5195 with `AGENT_CONSOLE_OPENCODE_PASSWORD`.
7. Pair each phone again (`pnpm pair`, link to the owner) if its server
   state folder changed; otherwise pairing holds.
8. Smoke test on a phone: new session answers live, permission prompt,
   stop, rename, delete, worktree create, push on finish.

## Rollback

Stop v2, restore the backed-up `~/.local/share/opencode`, start v1 as
before, restart :5199/:5195 without the password, run the pre-merge app
build.
