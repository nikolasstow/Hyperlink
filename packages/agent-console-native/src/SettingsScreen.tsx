/**
 * Full Settings — workspace organization (root, where clone/create puts
 * the main checkout, where linked worktrees go, which worktree opens by
 * default), session permission defaults, and server connection.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { Host, Slider } from "@expo/ui/swift-ui";
import {
  ActivityIndicator,
  LayoutAnimation,
  ScrollView,
  StyleSheet,
  Text,
  Switch,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { CardGlass } from "./CardGlass";
import { colors } from "./colors";
import { getLastScanAt, rescan } from "./repoScanCache";
import type { RootStackParamList } from "./RootNavigator";
import {
  getDefaultPermissionModeSync,
  primeDefaultPermissionMode,
  type PermissionMode,
} from "./sessionPermissions";
import { registerForPush } from "./push";
import {
  DEFAULT_REPO_TEMPLATE,
  DEFAULT_WORKTREE_TEMPLATE,
  getBackendAddress,
  getDefaultPermissionMode,
  getDefaultWorktreePreference,
  getRepoTemplate,
  getWorktreeTemplate,
  resolveRepoPath,
  resolveWorktreePath,
  setDefaultPermissionMode,
  setDefaultWorktreePreference,
  setRepoTemplate,
  setWorktreeTemplate,
  type DefaultWorktreePreference,
} from "./settings";
import { RUN_DELAY_STOPS, setRunCountdownEnabled, setRunCountdownSeconds, useRunCountdownEnabled, useRunCountdownSeconds } from "./runCountdown";
import { SystemIcon } from "./SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

const timeAgo = (ms: number): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

/** The countdown slider's box: a set height; the card's inner width. */
const SLIDER_HEIGHT = 34;

/** The Customize card's pages, a row each. */
const CUSTOMIZE_PAGES: ReadonlyArray<"Appearance" | "Extensions" | "Plugins"> = ["Appearance", "Extensions", "Plugins"];

export const SettingsScreen = (props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const runCountdown = useRunCountdownSeconds();
  const runDelayOn = useRunCountdownEnabled();
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { address, backend, rootDir, onChangeRootDir, onChangeServer } = useAppContext();

  const [rootDirDraft, setRootDirDraft] = React.useState(rootDir);
  const [repoTemplateDraft, setRepoTemplateDraft] = React.useState(DEFAULT_REPO_TEMPLATE);
  const [worktreeTemplateDraft, setWorktreeTemplateDraft] = React.useState(DEFAULT_WORKTREE_TEMPLATE);
  const [worktreePref, setWorktreePref] = React.useState<DefaultWorktreePreference>("main");
  const [defaultMode, setDefaultMode] = React.useState<PermissionMode>(getDefaultPermissionModeSync);
  const [lastScanAt, setLastScanAt] = React.useState<number | undefined>(undefined);
  const [scanning, setScanning] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    setRootDirDraft(rootDir);
  }, [rootDir]);

  React.useEffect(() => {
    void (async () => {
      const [repoTemplate, worktreeTemplate, pref, mode, scannedAt] = await Promise.all([
        getRepoTemplate(),
        getWorktreeTemplate(),
        getDefaultWorktreePreference(),
        getDefaultPermissionMode(),
        getLastScanAt(),
      ]);
      setRepoTemplateDraft(repoTemplate);
      setWorktreeTemplateDraft(worktreeTemplate);
      setWorktreePref(pref);
      setDefaultMode(mode);
      setLastScanAt(scannedAt);
    })();
  }, []);

  const saveRootDir = (): void => {
    const trimmed = rootDirDraft.trim();
    if (trimmed.length === 0 || trimmed === rootDir) {
      setRootDirDraft(rootDir);
      return;
    }
    onChangeRootDir(trimmed);
  };

  const saveRepoTemplate = (): void => {
    const trimmed = repoTemplateDraft.trim();
    const next = trimmed.length === 0 ? DEFAULT_REPO_TEMPLATE : trimmed;
    setRepoTemplateDraft(next);
    void setRepoTemplate(next);
  };

  const saveWorktreeTemplate = (): void => {
    const trimmed = worktreeTemplateDraft.trim();
    const next = trimmed.length === 0 ? DEFAULT_WORKTREE_TEMPLATE : trimmed;
    setWorktreeTemplateDraft(next);
    void setWorktreeTemplate(next);
  };

  const chooseWorktreePref = (pref: DefaultWorktreePreference): void => {
    setWorktreePref(pref);
    void setDefaultWorktreePreference(pref);
  };

  const [pushStatus, setPushStatus] = React.useState<string | undefined>(undefined);
  const [pushBusy, setPushBusy] = React.useState(false);

  // Explicit retry. iOS only ever shows the permission dialog once per
  // install, so once it has been dismissed or denied the automatic attempt at
  // launch can never surface it again — this reports exactly which step
  // stopped, including "denied in iOS settings", where the only fix is the
  // Settings app.
  const enablePush = async (): Promise<void> => {
    setPushBusy(true);
    setPushStatus(undefined);
    const backend = await getBackendAddress(address);
    const result = await registerForPush(backend);
    setPushBusy(false);
    setPushStatus(
      result.ok
        ? result.registered
          ? `Registered with ${backend}`
          : `Got a token, but ${backend} did not accept it — is the dev server running?`
        : result.reason,
    );
  };

  const chooseDefault = (mode: PermissionMode): void => {
    setDefaultMode(mode);
    primeDefaultPermissionMode(mode);
    void setDefaultPermissionMode(mode);
  };

  const runRescan = async (): Promise<void> => {
    setScanning(true);
    setScanError(undefined);
    try {
      await rescan(backend, rootDir);
      setLastScanAt(await getLastScanAt());
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Rescan failed.");
    } finally {
      setScanning(false);
    }
  };

  const rootForPreview = rootDirDraft.trim() || rootDir;
  const repoPreview = resolveRepoPath(
    rootForPreview,
    "Hyperlink",
    repoTemplateDraft.trim() || DEFAULT_REPO_TEMPLATE,
  );
  const worktreePreview = resolveWorktreePath(
    rootForPreview,
    "Hyperlink",
    "feature-branch",
    worktreeTemplateDraft.trim() || DEFAULT_WORKTREE_TEMPLATE,
  );

  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
        <Text style={[styles.sectionLabel, styles.sectionLabelFirst]}>Customize</Text>
        {/* One card, a row per page. */}
        <View style={[styles.card, styles.listCard]}>
          <CardGlass />
          {CUSTOMIZE_PAGES.map((page, index) => (
            <TouchableOpacity
              key={page}
              style={[styles.optionRow, index > 0 && styles.optionRowBorder]}
              onPress={() => props.navigation.navigate(page)}
              activeOpacity={0.6}
            >
              <Text style={styles.fieldLabel}>{page}</Text>
              <SystemIcon name="chevron.right" size={15} color={textColors.secondaryLabel} />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Dubz</Text>
        <TouchableOpacity style={styles.card} onPress={() => props.navigation.navigate("AgentButtonSettings")} activeOpacity={0.6}>
          <CardGlass />
          <View style={styles.linkRow}>
            <View style={styles.linkText}>
              <Text style={styles.fieldLabel}>Assistant Button</Text>
            </View>
            <SystemIcon name="chevron.right" size={15} color={textColors.secondaryLabel} />
          </View>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>Workspace</Text>
        <View style={styles.card}>
          <CardGlass />
          {/* A standard form row: the label, and the value beside it. */}
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Root Folder</Text>
            <TextInput
              style={styles.formInput}
              value={rootDirDraft}
              onChangeText={setRootDirDraft}
              onBlur={saveRootDir}
              onSubmitEditing={saveRootDir}
              placeholder="/Users/you/Coding"
              placeholderTextColor={textColors.placeholderText}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
            />
          </View>
          {/* The same card: where repos are found, and finding them. */}
          <View style={styles.cardSeparator} />
          <View style={styles.rowBetween}>
            <View style={styles.rowText}>
              <Text style={styles.hint}>
                {lastScanAt === undefined ? "Never scanned." : `Last scanned ${timeAgo(lastScanAt)}.`}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.actionChip, scanning && styles.actionChipDisabled]}
              onPress={() => void runRescan()}
              disabled={scanning}
              activeOpacity={0.6}
            >
              {scanning ? (
                <ActivityIndicator size="small" color={colors.tint} />
              ) : (
                <Text style={styles.actionChipText}>Rescan</Text>
              )}
            </TouchableOpacity>
          </View>
          {scanError !== undefined ? <Text style={styles.errorText}>{scanError}</Text> : null}
        </View>

        <Text style={styles.sectionLabel}>New repos (main checkout)</Text>
        <View style={styles.card}>
          <CardGlass />
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Path Template</Text>
            <TextInput
              style={styles.formInput}
              value={repoTemplateDraft}
              onChangeText={setRepoTemplateDraft}
              onBlur={saveRepoTemplate}
              onSubmitEditing={saveRepoTemplate}
              placeholder={DEFAULT_REPO_TEMPLATE}
              placeholderTextColor={textColors.placeholderText}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
            />
          </View>
          <Text style={styles.previewLabel}>Preview</Text>
          <Text style={styles.previewPath} numberOfLines={2} ellipsizeMode="head">
            {repoPreview}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>Linked worktrees</Text>
        <View style={styles.card}>
          <CardGlass />
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Path Template</Text>
            <TextInput
              style={styles.formInput}
              value={worktreeTemplateDraft}
              onChangeText={setWorktreeTemplateDraft}
              onBlur={saveWorktreeTemplate}
              onSubmitEditing={saveWorktreeTemplate}
              placeholder={DEFAULT_WORKTREE_TEMPLATE}
              placeholderTextColor={textColors.placeholderText}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
            />
          </View>
          <Text style={styles.previewLabel}>Preview</Text>
          <Text style={styles.previewPath} numberOfLines={2} ellipsizeMode="head">
            {worktreePreview}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>When opening a repo</Text>
        <View style={styles.card}>
          <CardGlass />
          {(
            [
              { value: "main", title: "Main checkout", detail: "Always the primary worktree" },
              { value: "last", title: "Last used", detail: "Remember per repo" },
            ] as const
          ).map((option, index) => (
            <TouchableOpacity
              key={option.value}
              style={[styles.optionRow, index > 0 && styles.optionRowBorder]}
              activeOpacity={0.6}
              onPress={() => chooseWorktreePref(option.value)}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{option.title}</Text>
              </View>
              {worktreePref === option.value ? (
                <SystemIcon name="checkmark" size={15} color={colors.tint} />
              ) : null}
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>New sessions start with</Text>
        <View style={styles.card}>
          <CardGlass />
          {(
            [
              { value: "full", title: "Allow all" },
              { value: "ask", title: "Ask before each action" },
            ] as const
          ).map((option, index) => (
            <TouchableOpacity
              key={option.value}
              style={[styles.optionRow, index > 0 && styles.optionRowBorder]}
              activeOpacity={0.6}
              onPress={() => chooseDefault(option.value)}
            >
              <Text style={styles.rowTitle}>{option.title}</Text>
              {defaultMode === option.value ? (
                <SystemIcon name="checkmark" size={15} color={colors.tint} />
              ) : null}
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Scripts</Text>
        <View style={styles.card}>
          <CardGlass />
          {/* A delay before a script runs, so a stray tap starts nothing: on,
           * its length on a slider; off, a tap runs it at once. */}
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Delay</Text>
            {runDelayOn ? <Text style={styles.formValue}>{runCountdown === 1 ? "1 second" : `${runCountdown} seconds`}</Text> : null}
            <Switch
              style={runDelayOn ? undefined : styles.switchAlone}
              value={runDelayOn}
              onValueChange={(on) => {
                // The slider comes and goes with the card resizing, not
                // snapping.
                LayoutAnimation.configureNext(LayoutAnimation.create(250, "easeInEaseOut", "opacity"));
                setRunCountdownEnabled(on);
              }}
            />
          </View>
          {runDelayOn ? (
            <Host style={{ width: windowWidth - 32 - 28, height: SLIDER_HEIGHT }}>
              {/* The slider moves between the stops by their place, not their
               * seconds: 1, 2, 3, 5, 10, 15, 30, evenly spaced. */}
              <Slider
                value={Math.max(0, RUN_DELAY_STOPS.indexOf(runCountdown))}
                min={0}
                max={RUN_DELAY_STOPS.length - 1}
                step={1}
                onValueChange={(stop) => {
                  const seconds = RUN_DELAY_STOPS[Math.round(stop)];
                  if (seconds !== undefined) setRunCountdownSeconds(seconds);
                }}
              />
            </Host>
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>Server</Text>
        <View style={styles.card}>
          <CardGlass />
          <Text style={styles.fieldLabel}>Address</Text>
          <Text style={styles.serverAddress} numberOfLines={1} ellipsizeMode="middle">
            {address}
          </Text>
          <TouchableOpacity style={styles.destructiveRow} activeOpacity={0.6} onPress={onChangeServer}>
            <Text style={styles.destructiveText}>Change server…</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionLabel}>Notifications</Text>
        <View style={styles.card}>
          <CardGlass />
          <TouchableOpacity
            disabled={pushBusy}
            activeOpacity={0.6}
            onPress={() => {
              void enablePush();
            }}
          >
            <Text style={[styles.fieldLabel, { color: colors.tint }]}>
              {pushBusy ? "Enabling…" : "Enable notifications"}
            </Text>
          </TouchableOpacity>
          {pushStatus === undefined ? null : <Text style={styles.hint}>{pushStatus}</Text>}
        </View>
    </ScrollView>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  sectionLabel: {
    color: text.secondaryLabel,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 28,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  sectionLabelFirst: {
    marginTop: 16,
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 8,
  },
  fieldLabel: {
    color: text.label,
    fontSize: 15,
    fontWeight: "600",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  linkText: {
    flex: 1,
    gap: 2,
  },
  hint: {
    color: text.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    marginTop: 2,
    color: text.label,
    fontSize: 15,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.fillBackground,
  },
  formRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 15,
  },
  formLabel: {
    color: text.label,
    fontSize: 16,
  },
  formValue: {
    color: text.secondaryLabel,
    fontSize: 16,
    marginLeft: "auto",
  },
  // With no value beside it, the switch still sits at the row's end.
  switchAlone: {
    marginLeft: "auto",
  },
  formInput: {
    flex: 1,
    color: text.label,
    fontSize: 16,
    textAlign: "right",
    padding: 0,
  },
  previewLabel: {
    color: text.secondaryLabel,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  previewPath: {
    color: text.secondaryLabel,
    fontSize: 13,
    fontFamily: "Menlo",
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: text.label,
    fontSize: 15,
    fontWeight: "500",
  },
  actionChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.accentTint,
    minWidth: 72,
    alignItems: "center",
  },
  actionChipDisabled: {
    opacity: 0.6,
  },
  actionChipText: {
    color: colors.tint,
    fontSize: 14,
    fontWeight: "600",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 15,
  },
  // A card of rows: the rows carry their own vertical padding.
  listCard: {
    paddingVertical: 2,
    gap: 0,
  },
  cardSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  optionRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  optionFooter: {
    marginTop: 2,
  },
  serverAddress: {
    color: text.label,
    fontSize: 15,
  },
  destructiveRow: {
    paddingTop: 6,
    paddingBottom: 2,
  },
  destructiveText: {
    color: colors.destructive,
    fontSize: 15,
    fontWeight: "500",
  },
  errorText: {
    color: colors.destructive,
    fontSize: 13,
  },
});
