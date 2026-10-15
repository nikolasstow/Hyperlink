# agent-console

The servers behind the native app (`packages/agent-console-native`). The
browser client that once lived here is gone.

## Run

Both talk to opencode v2 (`:4096` on the shared machine). When opencode runs
with a password, set the same one for both:
`AGENT_CONSOLE_OPENCODE_PASSWORD` (Basic auth, user `opencode`).

- `pnpm serve`: the API on `:5199`. It handles pairing and device auth,
  the model catalog, file sync, extension views, workspaces, and forwards
  `/opencode/*` to opencode with the password added.
- `pnpm dev`: the vite backend on `:5195`. Its plugins hold push
  notifications (`notificationsPlugin`), EAS builds, GitHub, files,
  previews and processes. It serves no page.
- `pnpm pair`: prints a pairing link and code for a phone.

## GitHub search / repo metadata

New-repo search and preview hit the vite middleware at `/github/*`, which
forwards to `https://api.github.com`. Optional but recommended: set
`GITHUB_TOKEN` or `GH_TOKEN` in the environment that runs `pnpm dev`, so
authenticated rate limits apply (anonymous is 60 req/hr).
