/**
 * The live link to a resin printer: straight to the printer on the LAN when
 * it answers, otherwise through the relay on the home server (Tailscale).
 *
 * Both ends speak the same SDCP frames, so the page does not care which one
 * it has. The relay also answers `GET /api/state`, which tells the app the
 * printer's LAN address and ids; the last answer is kept in AsyncStorage so
 * the direct path works even when the relay is down.
 *
 * Layer images, the camera, and files come from the relay, so the hook keeps
 * checking `GET /api/state` and reports `relayReachable`. When the relay is
 * down on the LAN, the page decodes layers itself (`directLayers.ts`).
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";
import { AppState } from "react-native";
import { authedFetch } from "../auth/serverTokens";
import { CMD_ATTRIBUTES, CMD_STATUS, controlRequest, PRINTER_PORT, PRINTER_WEBSOCKET_PATH, parseFrame, relayBaseOf, refreshRequest, type ControlCmd, type PrinterAttributes, type PrinterStatus, type RelayState } from "./sdcp";

/** Which way the page is connected. */
export type Via = "Direct" | "Relay";

export type LinkState = { readonly kind: "Connecting" } | { readonly kind: "Open"; readonly via: Via } | { readonly kind: "Offline"; readonly retryAt: number };

/** What the relay told us about the printer, kept for when the relay is down. */
interface PrinterIdentity {
  readonly ip: string;
  readonly port: number;
  readonly mainboardId: string;
  readonly brandId: string;
}

export interface PrinterLink {
  readonly link: LinkState;
  readonly status: PrinterStatus | undefined;
  readonly attributes: PrinterAttributes | undefined;
  /** The relay's base URL, for images. */
  readonly relayBase: string;
  /** Whether the last `/api/state` call answered. */
  readonly relayReachable: boolean;
  /** The relay's HTTPS address, when it has one: its camera page plays full frame rate there. */
  readonly secureUrl: string | undefined;
  readonly printerIp: string | undefined;
  /** The last notice the printer or relay sent. */
  readonly notice: string | undefined;
  /** Unix ms of the last frame. */
  readonly updatedAt: number | undefined;
  /** Drops the connection and starts over (direct first). */
  readonly reconnect: () => void;
  /**
   * Sends pause, stop, or resume over whichever connection is open (the
   * printer, or the relay, which passes it on) and resolves with the
   * printer's ack: 0 is OK. Rejects when there is no connection or no answer.
   */
  readonly sendControl: (cmd: ControlCmd) => Promise<number>;
}

/** Pause can take a while to be acknowledged; a stop must never be resent blindly, so wait long. */
const CONTROL_TIMEOUT_MS = 20000;

const DIRECT_TIMEOUT_MS = 2500;
const RELAY_TIMEOUT_MS = 6000;
const RETRY_MS = 4000;
/** An idle printer only reports on change; ask every so often so the page stays current and dead links show. */
const REFRESH_MS = 15000;
const RELAY_STATE_MS = 30000;

const identityKey = (serverAddress: string): string => `agent-console-native:printer:${serverAddress}`;

const loadIdentity = async (serverAddress: string): Promise<PrinterIdentity | undefined> => {
  const raw = await AsyncStorage.getItem(identityKey(serverAddress)).catch(() => null);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as PrinterIdentity;
  } catch {
    return undefined;
  }
};

const saveIdentity = (serverAddress: string, identity: PrinterIdentity): void => {
  void AsyncStorage.setItem(identityKey(serverAddress), JSON.stringify(identity)).catch(() => undefined);
};

/** Opens a socket, or rejects when it does not open in time. */
const openSocket = (url: string, timeoutMs: number): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`timed out opening ${url}`));
    }, timeoutMs);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve(socket);
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`could not open ${url}`));
    };
  });

const requestId = (): string => `${Date.now().toString(16)}${Math.floor(Math.random() * 0xffffffff).toString(16)}`;

export const usePrinterLink = (serverAddress: string | undefined): PrinterLink => {
  const relayBase = serverAddress === undefined ? "" : relayBaseOf(serverAddress);
  const [link, setLink] = React.useState<LinkState>({ kind: "Connecting" });
  const [status, setStatus] = React.useState<PrinterStatus | undefined>(undefined);
  const [attributes, setAttributes] = React.useState<PrinterAttributes | undefined>(undefined);
  const [relayReachable, setRelayReachable] = React.useState(false);
  const [secureUrl, setSecureUrl] = React.useState<string | undefined>(undefined);
  const [notice, setNotice] = React.useState<string | undefined>(undefined);
  const [updatedAt, setUpdatedAt] = React.useState<number | undefined>(undefined);
  const [identity, setIdentity] = React.useState<PrinterIdentity | undefined>(undefined);
  const [generation, setGeneration] = React.useState(0);
  const identityRef = React.useRef<PrinterIdentity | undefined>(undefined);
  identityRef.current = identity;

  // The relay's view: printer identity, and a first status to draw before any frame arrives.
  React.useEffect(() => {
    if (serverAddress === undefined) return;
    let alive = true;
    void loadIdentity(serverAddress).then((cached) => {
      if (alive && cached !== undefined && identityRef.current === undefined) setIdentity(cached);
    });
    // Keep checking while connected directly too: layer images, the camera, and files come
    // from the relay, and the page must notice when it goes away. This asks the relay only;
    // it does not make the relay open a printer connection.
    const tick = (): void => {
      void authedFetch(`${relayBase}/api/state`, { cache: "no-store" })
        .then((response) => response.json())
        .then((state: RelayState) => {
          if (!alive) return;
          setRelayReachable(true);
          setSecureUrl(state.relay?.secureUrl?.replace(/\/$/, "") ?? undefined);
          const next: PrinterIdentity = { ip: state.printer.ip, port: state.printer.port, mainboardId: state.printer.mainboardId, brandId: state.printer.brandId };
          setIdentity((current) => (current !== undefined && current.ip === next.ip && current.mainboardId === next.mainboardId && current.brandId === next.brandId ? current : next));
          saveIdentity(serverAddress, next);
          if (state.status !== null) setStatus((current) => current ?? state.status ?? undefined);
          if (state.attributes !== null) setAttributes((current) => current ?? state.attributes ?? undefined);
        })
        .catch(() => {
          if (alive) setRelayReachable(false);
        });
    };
    tick();
    const id = setInterval(tick, RELAY_STATE_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [serverAddress, relayBase]);

  const printerIp = identity?.ip;
  const printerPort = identity?.port ?? PRINTER_PORT;
  const socketRef = React.useRef<WebSocket | undefined>(undefined);
  const pendingRef = React.useRef(new Map<string, { readonly resolve: (ack: number) => void; readonly timer: ReturnType<typeof setTimeout> }>());

  // Leaving the page drops pending controls without an answer: a late "did not answer"
  // would show on another screen, about a command that most likely worked.
  React.useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      pending.forEach((entry) => clearTimeout(entry.timer));
      pending.clear();
    };
  }, []);

  // The socket: direct first when the printer's address is known, then the relay.
  React.useEffect(() => {
    if (serverAddress === undefined) return;
    let alive = true;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // One dial at a time: a second one could open a second socket that nothing closes.
    let dialing = false;

    const send = (cmd: typeof CMD_STATUS | typeof CMD_ATTRIBUTES): void => {
      const ids = identityRef.current;
      if (socket === undefined || socket.readyState !== WebSocket.OPEN || ids === undefined) return;
      socket.send(refreshRequest(cmd, ids, requestId(), Date.now()));
    };

    const attach = (opened: WebSocket, via: Via): void => {
      socket = opened;
      socketRef.current = opened;
      setLink({ kind: "Open", via });
      opened.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        const frame = parseFrame(event.data);
        if (frame.kind === "status") {
          setStatus(frame.status);
          setUpdatedAt(Date.now());
        } else if (frame.kind === "attributes") {
          setAttributes(frame.attributes);
        } else if (frame.kind === "notice") {
          setNotice(frame.message);
        } else if (frame.kind === "response" && frame.ack !== undefined) {
          const entry = pendingRef.current.get(frame.requestId);
          if (entry !== undefined) {
            pendingRef.current.delete(frame.requestId);
            clearTimeout(entry.timer);
            entry.resolve(frame.ack);
          }
        }
      };
      opened.onclose = () => {
        if (!alive) return;
        socket = undefined;
        socketRef.current = undefined;
        setLink({ kind: "Offline", retryAt: Date.now() + RETRY_MS });
        retry = setTimeout(connect, RETRY_MS);
      };
      send(CMD_ATTRIBUTES);
      send(CMD_STATUS);
    };

    const connect = async (): Promise<void> => {
      if (dialing) return;
      dialing = true;
      try {
        await dial();
      } finally {
        dialing = false;
      }
    };

    const dial = async (): Promise<void> => {
      setLink({ kind: "Connecting" });
      const plan: ReadonlyArray<readonly [Via, string, number]> = [
        ...(printerIp === undefined ? [] : [["Direct", `ws://${printerIp}:${printerPort}${PRINTER_WEBSOCKET_PATH}`, DIRECT_TIMEOUT_MS] as const]),
        ["Relay", `${relayBase.replace(/^http/, "ws")}/websocket`, RELAY_TIMEOUT_MS] as const,
      ];
      for (const [via, url, timeout] of plan) {
        try {
          const opened = await openSocket(url, timeout);
          if (!alive) {
            opened.close();
            return;
          }
          attach(opened, via);
          return;
        } catch {
          // Try the next way in.
        }
      }
      if (!alive) return;
      setLink({ kind: "Offline", retryAt: Date.now() + RETRY_MS });
      retry = setTimeout(connect, RETRY_MS);
    };

    void connect();
    const refresh = setInterval(() => send(CMD_STATUS), REFRESH_MS);
    // Coming back to the foreground: the socket may have died while suspended.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && (socket === undefined || socket.readyState !== WebSocket.OPEN)) {
        if (retry !== undefined) clearTimeout(retry);
        void connect();
      }
    });
    return () => {
      alive = false;
      subscription.remove();
      if (retry !== undefined) clearTimeout(retry);
      clearInterval(refresh);
      if (socket !== undefined) {
        socket.onclose = null;
        socket.close();
      }
      socketRef.current = undefined;
    };
  }, [serverAddress, relayBase, printerIp, printerPort, generation]);

  const reconnect = React.useCallback(() => setGeneration((g) => g + 1), []);

  const sendControl = React.useCallback(
    (cmd: ControlCmd): Promise<number> =>
      new Promise((resolve, reject) => {
        const socket = socketRef.current;
        const ids = identityRef.current;
        if (socket === undefined || socket.readyState !== WebSocket.OPEN || ids === undefined) {
          reject(new Error("Not connected to the printer"));
          return;
        }
        const id = requestId();
        const timer = setTimeout(() => {
          pendingRef.current.delete(id);
          reject(new Error("The printer did not answer"));
        }, CONTROL_TIMEOUT_MS);
        pendingRef.current.set(id, {
          timer,
          resolve: (ack) => {
            resolve(ack);
            // Ask for status at once so the page shows the new state.
            const current = socketRef.current;
            if (current !== undefined && current.readyState === WebSocket.OPEN) current.send(refreshRequest(CMD_STATUS, ids, requestId(), Date.now()));
          },
        });
        socket.send(controlRequest(cmd, ids, id, Date.now()));
      }),
    [],
  );

  return { link, status, attributes, relayBase, relayReachable, secureUrl, printerIp, notice, updatedAt, reconnect, sendControl };
};
