/**
 * The opencode server this one talks to: where it is
 * (`AGENT_CONSOLE_OPENCODE_URL`, default `http://127.0.0.1:4096`) and its
 * password (`AGENT_CONSOLE_OPENCODE_PASSWORD`, Basic auth as user `opencode`;
 * opencode v2 always has one). Used by the proxy (opencodeProxy.ts) and the
 * file hub (files/hub.ts). The password stays on this machine.
 *
 * @internal
 */
import { Config, Option, Redacted } from "effect";
import { Base64 } from "effect/encoding";
import { Headers } from "effect/http";

export const opencodeUrl = Config.String("AGENT_CONSOLE_OPENCODE_URL").pipe(Config.withDefault("http://127.0.0.1:4096"));

export const opencodePassword = Config.option(Config.Redacted("AGENT_CONSOLE_OPENCODE_PASSWORD"));

/** opencode's credentials on `headers`: any other `authorization` (the app's)
 * dropped, opencode's own set when it has a password. */
export const withOpencodeAuth = (headers: Headers.Headers, password: Option.Option<Redacted.Redacted<string>>): Headers.Headers =>
  Option.match(password, {
    onNone: () => Headers.remove(headers, "authorization"),
    onSome: (secret) => Headers.set(headers, "authorization", `Basic ${Base64.encode(`opencode:${Redacted.value(secret)}`)}`),
  });
