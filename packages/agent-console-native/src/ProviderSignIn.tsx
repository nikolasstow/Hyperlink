/**
 * The sign-in sheet for one provider — the UI equivalent of what
 * `opencode auth login` walks through in the TUI.
 *
 * A provider's methods come from the server (`client.provider.auth()`) and a
 * method's *index* in that array is the `method` number the OAuth calls take,
 * so the index is carried through the flow rather than re-derived from a
 * label. Three shapes are handled, chosen by the server, not guessed here:
 *
 * - `api` — a secure field, saved with `auth.set`.
 * - `oauth` + `method: "code"` — open the authorization page, paste back the
 *   code it shows, post it to `oauth.callback`.
 * - `oauth` + `method: "auto"` — open the authorization page, then poll
 *   `oauth.callback` with no code until the server reports it landed.
 *
 * Both OAuth shapes complete against the opencode server rather than a
 * redirect back into the app, which is why neither needs a custom URL scheme
 * or any native configuration. A redirect-based flow would.
 *
 * @internal
 */
import * as React from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import {
  completeOauth,
  initialMethodIndex,
  methodAt,
  normalizeApiKey,
  normalizeAuthCode,
  OAUTH_POLL_INTERVAL_MS,
  pollExpired,
  signInWithApiKey,
  startOauth,
  type ProviderAuthAuthorization,
  type ProviderRow,
} from "./providerAuth";
import { SystemIcon } from "./SystemIcon";

/**
 * Which step the sheet is on. `pick` is skipped entirely when the provider
 * offers a single method — there is nothing to choose.
 */
type Stage =
  | { readonly kind: "pick" }
  | { readonly kind: "api" }
  | {
      readonly kind: "oauth";
      readonly method: number;
      readonly authorization: ProviderAuthAuthorization;
    };

const SignInFlow = (props: {
  readonly row: ProviderRow;
  readonly onClose: () => void;
  readonly onSignedIn: () => void;
}): React.ReactElement => {
  const { row } = props;
  const { client } = useAppContext();

  const [stage, setStage] = React.useState<Stage>({ kind: "pick" });
  // Seeded, not defaulted to false: a provider with a single method enters it
  // on mount, and starting at `false` would render its one-item menu for a
  // frame first. Cleared when that entry finishes — so a failed auto-entry
  // falls back to the menu, which is the retry.
  const [busy, setBusy] = React.useState(() => initialMethodIndex(row.methods) !== undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [apiKey, setApiKey] = React.useState("");
  const [code, setCode] = React.useState("");
  const [opened, setOpened] = React.useState(false);
  /** Set to the method index while the `auto` flow is polling; else undefined. */
  const [polling, setPolling] = React.useState<number | undefined>(undefined);

  // Held in a ref so the poll effect below depends only on what should
  // actually restart it. Depending on the callback itself would tear the
  // interval down and start a fresh one on every render of the parent.
  const onSignedInRef = React.useRef(props.onSignedIn);
  React.useEffect(() => {
    onSignedInRef.current = props.onSignedIn;
  }, [props.onSignedIn]);

  /**
   * Entering a method. `api` just swaps the form in; `oauth` has to ask the
   * server for the authorization URL first, and that call can fail, so the
   * stage only advances once a URL is actually in hand.
   */
  const chooseMethod = React.useCallback(
    async (index: number): Promise<void> => {
      const method = methodAt(row.methods, index);
      if (method === undefined) {
        setBusy(false);
        setError("That sign-in method is no longer offered by the server.");
        return;
      }
      setError(undefined);
      if (method.type === "api") {
        setBusy(false);
        setStage({ kind: "api" });
        return;
      }
      setBusy(true);
      const started = await startOauth(client, row.id, index);
      setBusy(false);
      if (!started.ok) {
        setError(started.message);
        return;
      }
      setOpened(false);
      setStage({
        kind: "oauth",
        method: index,
        authorization: started.authorization,
      });
    },
    [client, row],
  );

  // A single method is not a choice — go straight into it on open.
  React.useEffect(() => {
    const only = initialMethodIndex(row.methods);
    if (only === undefined) return;
    void chooseMethod(only);
  }, [row, chooseMethod]);

  /**
   * The `auto` flow's wait. `oauth.callback` answers `false` while the user
   * has not finished authorizing yet, so a `rejected` outcome means "keep
   * asking" here — unlike the pasted-code flow, where it means the code was
   * refused. A real error stops the wait rather than being swallowed into
   * another round.
   */
  React.useEffect(() => {
    if (polling === undefined) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const startedAt = Date.now();

    const tick = async (): Promise<void> => {
      const outcome = await completeOauth(client, row.id, polling, undefined);
      if (cancelled) return;
      if (outcome.kind === "ok") {
        setPolling(undefined);
        onSignedInRef.current();
        return;
      }
      if (outcome.kind === "failed") {
        setPolling(undefined);
        setError(outcome.message);
        return;
      }
      if (pollExpired(startedAt, Date.now())) {
        setPolling(undefined);
        setError("Timed out waiting for authorization. Open the sign-in page and try again.");
        return;
      }
      timer = setTimeout(() => void tick(), OAUTH_POLL_INTERVAL_MS);
    };

    timer = setTimeout(() => void tick(), OAUTH_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [polling, client, row.id]);

  const openAuthorizationPage = async (authorization: ProviderAuthAuthorization, method: number): Promise<void> => {
    setError(undefined);
    try {
      await Linking.openURL(authorization.url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not open the sign-in page.");
      return;
    }
    setOpened(true);
    if (authorization.method === "auto") setPolling(method);
  };

  const saveApiKey = async (): Promise<void> => {
    const key = normalizeApiKey(apiKey);
    if (key === undefined) {
      setError("Enter an API key.");
      return;
    }
    setError(undefined);
    setBusy(true);
    const outcome = await signInWithApiKey(client, row.id, key);
    setBusy(false);
    if (outcome.kind === "ok") {
      props.onSignedIn();
      return;
    }
    setError(outcome.kind === "rejected" ? `${row.name} did not accept that key.` : outcome.message);
  };

  const submitCode = async (method: number): Promise<void> => {
    const value = normalizeAuthCode(code);
    if (value === undefined) {
      setError("Paste the code from the sign-in page.");
      return;
    }
    setError(undefined);
    setBusy(true);
    const outcome = await completeOauth(client, row.id, method, value);
    setBusy(false);
    if (outcome.kind === "ok") {
      props.onSignedIn();
      return;
    }
    setError(outcome.kind === "rejected" ? "That code was not accepted. Try signing in again." : outcome.message);
  };

  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={props.onClose} activeOpacity={0.6}>
          <Text style={styles.headerAction}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {row.name}
        </Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {stage.kind === "pick" && !busy ? (
          <>
            <Text style={styles.sectionLabel}>How to sign in</Text>
            <View style={styles.card}>
              {row.methods.map((method, index) => (
                <TouchableOpacity
                  key={`${method.type}:${method.label}`}
                  style={[styles.optionRow, index > 0 && styles.optionRowBorder]}
                  activeOpacity={0.6}
                  onPress={() => void chooseMethod(index)}
                >
                  <Text style={styles.rowTitle}>{method.label}</Text>
                  <SystemIcon name="chevron.right" size={14} color={colors.secondaryLabel} />
                </TouchableOpacity>
              ))}
              {row.methods.length === 0 ? (
                <Text style={styles.hint}>
                  {row.env.length === 0
                    ? "This provider has no interactive sign-in."
                    : `Set ${row.env.join(" or ")} on the opencode server to use this provider.`}
                </Text>
              ) : null}
            </View>
          </>
        ) : null}

        {stage.kind === "api" ? (
          <>
            <Text style={styles.sectionLabel}>API key</Text>
            <View style={styles.card}>
              <TextInput
                style={styles.input}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="Paste your API key"
                placeholderTextColor={colors.placeholderText}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoFocus
                onSubmitEditing={() => void saveApiKey()}
              />
              <TouchableOpacity
                style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}
                activeOpacity={0.6}
                disabled={busy}
                onPress={() => void saveApiKey()}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.tint} />
                ) : (
                  <Text style={styles.primaryButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        {stage.kind === "oauth" ? (
          <>
            <Text style={styles.sectionLabel}>Sign in</Text>
            <View style={styles.card}>
              <Text style={styles.hint}>{stage.authorization.instructions}</Text>
              <TouchableOpacity
                style={styles.primaryButton}
                activeOpacity={0.6}
                onPress={() => void openAuthorizationPage(stage.authorization, stage.method)}
              >
                <Text style={styles.primaryButtonText}>
                  {opened ? "Open sign-in page again" : "Open sign-in page"}
                </Text>
              </TouchableOpacity>
            </View>

            {stage.authorization.method === "code" ? (
              <View style={styles.card}>
                <Text style={styles.fieldLabel}>Code</Text>
                <TextInput
                  style={styles.input}
                  value={code}
                  onChangeText={setCode}
                  placeholder="Paste the code from that page"
                  placeholderTextColor={colors.placeholderText}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  onSubmitEditing={() => void submitCode(stage.method)}
                />
                <TouchableOpacity
                  style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}
                  activeOpacity={0.6}
                  disabled={busy}
                  onPress={() => void submitCode(stage.method)}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={colors.tint} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Connect</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}

            {stage.authorization.method === "auto" && polling !== undefined ? (
              <View style={[styles.card, styles.waitingRow]}>
                <ActivityIndicator size="small" color={colors.secondaryLabel} />
                <Text style={styles.hint}>Waiting for authorization…</Text>
              </View>
            ) : null}
          </>
        ) : null}

        {busy && stage.kind === "pick" ? (
          <View style={[styles.card, styles.waitingRow]}>
            <ActivityIndicator size="small" color={colors.secondaryLabel} />
            <Text style={styles.hint}>Starting sign-in…</Text>
          </View>
        ) : null}

        {error === undefined ? null : <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>
    </View>
  );
};

/**
 * `row === undefined` closes the sheet. The flow is keyed by provider so
 * every open starts from a clean stage rather than inheriting the last
 * provider's half-finished form.
 */
export const ProviderSignIn = (props: {
  readonly row: ProviderRow | undefined;
  readonly onClose: () => void;
  readonly onSignedIn: () => void;
}): React.ReactElement => (
  <Modal
    visible={props.row !== undefined}
    animationType="slide"
    presentationStyle="pageSheet"
    onRequestClose={props.onClose}
  >
    {props.row === undefined ? null : (
      <SignInFlow key={props.row.id} row={props.row} onClose={props.onClose} onSignedIn={props.onSignedIn} />
    )}
  </Modal>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  headerButton: {
    minWidth: 72,
    height: 44,
    paddingHorizontal: 12,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  headerAction: {
    color: colors.tint,
    fontSize: 17,
  },
  headerTitle: {
    flex: 1,
    color: colors.label,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  sectionLabel: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 16,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 8,
  },
  fieldLabel: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "600",
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    marginTop: 2,
    color: colors.label,
    fontSize: 15,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.fillBackground,
  },
  rowTitle: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "500",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
  },
  optionRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  primaryButton: {
    marginTop: 2,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: colors.accentTint,
    alignItems: "center",
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: colors.tint,
    fontSize: 15,
    fontWeight: "600",
  },
  waitingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  errorText: {
    color: colors.destructive,
    fontSize: 13,
    marginHorizontal: 4,
    marginTop: 4,
  },
});
