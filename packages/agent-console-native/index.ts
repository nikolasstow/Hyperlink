import "react-native-gesture-handler";
import "./src/cryptoPolyfill";
import { registerRootComponent } from "expo";
import { fetch as expoFetch } from "expo/fetch";

import App from "./App";
import { startConversations } from "./src/conversations/useConversations";
import { startOutbox } from "./src/outbox/useOutbox";

// The OpenCode SDK's SSE helper (client.event.subscribe, used by
// useSessionStream.ts for live chat updates) calls the bare `fetch`
// identifier directly rather than the SDK client's injectable `fetch`
// config — confirmed by reading its generated source
// (@opencode-ai/sdk/dist/gen/core/serverSentEvents.gen.js). RN's default
// fetch can't expose a streamable response body, so without this override
// the "live" stream only ever resolves once fully buffered — which reads
// as "nothing updates until you leave and reopen the session" (a fresh
// `session.messages` history fetch, which does go through the client's
// own request path and picks up whatever finished in the background).
// Must run before any module reaches for `fetch`, hence first line here.
globalThis.fetch = expoFetch;

// The outbox resumes what was queued (and defines its background task, which
// iOS may launch the app straight into).
startOutbox();

// What the device kept of conversations is read back now, before any chat
// is opened.
startConversations();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
