/**
 * Compiles the App Intents into the MAIN app target.
 *
 * App Intents that open the app (`openAppWhenRun = true`, e.g. "Open a Session")
 * cannot live in an App Intents *extension* — an ExtensionKit process has no way
 * to foreground its host app, so running such an intent from the extension fails
 * with a generic "internal error occurred". Apple's rule: intents that open the
 * app must be compiled into the app target. And an Expo module's static-framework
 * pod isn't scanned by the app target's App Intents metadata processor either, so
 * the intents wouldn't be discovered from there.
 *
 * So the intents live as plain source under `plugins/app-intents-src/`, and this
 * plugin copies them into the generated `ios/<App>/AppIntents/` folder and adds
 * them to the app target's Sources build phase on every prebuild (the `ios/`
 * folder is gitignored and regenerated, so a config plugin is the only durable
 * way to keep them wired in). One `AppShortcutsProvider` in the app target then
 * surfaces every intent to Shortcuts / Siri / Spotlight — including the one that
 * opens the app.
 *
 * The main app already carries the app-group entitlement and the ATS exception,
 * so the intents inherit both: they read the server address from the shared app
 * group and post to the http opencode server exactly as before.
 *
 * @type {import('@expo/config-plugins')}
 */
const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/** Xcode group + on-disk folder name for the copied intent sources. */
const INTENTS_GROUP_NAME = "AppIntents";

/** The intent sources, relative to `plugins/app-intents-src/`. */
const SWIFT_FILES = [
  "OpencodeClient.swift",
  "SessionEntity.swift",
  "Intents.swift",
  "OpenSessionIntent.swift",
  "AppShortcuts.swift",
];

/** The directory holding the intent sources, kept out of the generated project. */
const SOURCE_DIR = path.join(__dirname, "app-intents-src");

/**
 * Find the application target's uuid. Not `getFirstTarget()`: with the Live
 * Activity and SiriKit extensions present, "first" isn't guaranteed to be the
 * app, so match on the application product type instead.
 */
const findAppTargetUuid = (project) => {
  const targets = project.pbxNativeTargetSection();
  for (const uuid of Object.keys(targets)) {
    const target = targets[uuid];
    if (target && target.productType === '"com.apple.product-type.application"') {
      return uuid;
    }
  }
  throw new Error("withAppIntents: could not find the application target in the Xcode project.");
};

const withAppIntents = (config) => {
  config = withDangerousMod(config, [
    "ios",
    (dangerousConfig) => {
      const projectName = dangerousConfig.modRequest.projectName;
      const targetDir = path.join(
        dangerousConfig.modRequest.platformProjectRoot,
        projectName,
        INTENTS_GROUP_NAME,
      );
      fs.mkdirSync(targetDir, { recursive: true });
      for (const file of SWIFT_FILES) {
        fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(targetDir, file));
      }
      return dangerousConfig;
    },
  ]);

  config = withXcodeProject(config, (xcodeConfig) => {
    const project = xcodeConfig.modResults;
    const projectName = xcodeConfig.modRequest.projectName;

    const groupPath = path.join(projectName, INTENTS_GROUP_NAME);
    const intentsGroupId = project.pbxCreateGroup(INTENTS_GROUP_NAME, groupPath);
    const mainGroup = project.getFirstProject().firstProject.mainGroup;
    project.addToPbxGroup(intentsGroupId, mainGroup);

    const appTargetUuid = findAppTargetUuid(project);
    for (const file of SWIFT_FILES) {
      project.addSourceFile(file, { target: appTargetUuid }, intentsGroupId);
    }

    return xcodeConfig;
  });

  return config;
};

module.exports = withAppIntents;
