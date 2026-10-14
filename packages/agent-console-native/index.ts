import "react-native-gesture-handler";
import "./src/cryptoPolyfill";
import { registerRootComponent } from "expo";
import { fetch as expoFetch } from "expo/fetch";

import App from "./App";
import { startConversations } from "./src/conversations/useConversations";
import { startSessionBackgrounds } from "./src/sessions/useSessionBackground";
import { startHomeLayout } from "./src/home/useHomeLayout";
import { startKeptThemes } from "./src/useCodeTheme";
import { startCodeFonts } from "./src/fonts/useCodeFonts";
import { startFileScrolls } from "./src/files/useFileScrolls";
import { startServerAuth } from "./src/auth/useServerAuth";
import { startModelCatalog } from "./src/models/useModelCatalog";
import { startBarWindow } from "./src/dubz/useBarWindow";
import { startFileNav } from "./src/files/useFileNav";
import { startKeptNav } from "./src/navigation/useKeptNav";
import { startFavorites } from "./src/favorites/useFavorites";
import { loadAutosaveSettings } from "./src/files/autosaveSettings";
import { loadDirtyEdits } from "./src/files/fileEdits";
import { loadKept } from "./src/files/fileKeep";
import { startOutbox } from "./src/outbox/useOutbox";

// Every bare `fetch` in the app is expo/fetch (it can stream a response
// body; React Native's own reads it whole). Must run before any module
// reaches for `fetch`, hence first here.
globalThis.fetch = expoFetch;

// The outbox resumes what was queued (and defines its background task, which
// iOS may launch the app straight into).
startOutbox();

// What the device kept of conversations is read back now, before any chat
// is opened.
startConversations();
startSessionBackgrounds();
startHomeLayout();
startKeptThemes();
startCodeFonts();
startFileScrolls();
startServerAuth();
startModelCatalog();
startBarWindow();
startFileNav();
startKeptNav();
startFavorites();
// Read back which files have pending (unsaved-to-disk) edits, for the folder
// view's local-changes indicator; and which are kept on device for offline.
void loadDirtyEdits();
void loadKept();
void loadAutosaveSettings();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
