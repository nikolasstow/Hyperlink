/**
 * A collection page's slide-up sheets.
 *
 * - `FormSheet` fills in a form: a plugin's (Edit Script, Duplicate, New
 *   Script) or the app's own (a filter or category). What submitting does is
 *   the caller's; a failure stays in the sheet with its message, so nothing
 *   is lost and nothing fails quietly.
 * - `CategoriesSheet` puts scripts in and out of categories: every category
 *   with a check (all of them are in it), a dash (some are), or nothing, and
 *   a row to make a new one.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { membership, type Category } from "./collectionModel";
import { symbolForIcon } from "./codicons";
import { CardGlass } from "./CardGlass";
import { colors } from "./colors";
import { type TextColors, useScreenBackground, useTextColors, useThemedStyles } from "./theme";
import type { CollectionItem, CollectionState, FormField, FormSpec } from "./pagesClient";
import { SystemIcon } from "./SystemIcon";

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The bar across a sheet's top: cancel, its title, and its action. */
const SheetBar = (props: {
  readonly title: string;
  readonly action: string;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onAction: () => void;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  return (
  <View style={styles.bar}>
    <Pressable onPress={props.onCancel} hitSlop={8}>
      <Text style={styles.barButton}>Cancel</Text>
    </Pressable>
    <Text style={styles.barTitle} numberOfLines={1}>
      {props.title}
    </Text>
    {props.busy ? (
      <ActivityIndicator color={textColors.secondaryLabel} />
    ) : (
      <Pressable onPress={props.onAction} hitSlop={8}>
        <Text style={[styles.barButton, styles.barAction]}>{props.action}</Text>
      </Pressable>
    )}
  </View>
);
};

/** A choice among options: a card of rows, the chosen one checked. */
const ChoiceList = (props: {
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly value: string;
  readonly onChange: (value: string) => void;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  return (
  <View style={styles.card}>
    <CardGlass />
    {props.options.map((option, index) => (
      <Pressable key={option.value} style={[styles.choice, index > 0 && styles.rowBorder]} onPress={() => props.onChange(option.value)}>
        <Text style={styles.choiceLabel} numberOfLines={1}>
          {option.label}
        </Text>
        {option.value === props.value ? <SystemIcon name="checkmark" size={15} color={colors.tint} /> : null}
      </Pressable>
    ))}
  </View>
);
};

/** The groups a `group` field chooses among. */
export interface GroupOption {
  readonly value: string;
  readonly label: string;
}

const startingValues = (spec: FormSpec, group: string | undefined): Readonly<Record<string, string>> =>
  Object.fromEntries(spec.fields.map((field) => [field.id, field.kind === "group" && group !== undefined ? group : field.value]));

const Field = (props: {
  readonly field: FormField;
  readonly value: string;
  readonly groups: ReadonlyArray<GroupOption>;
  readonly onChange: (value: string) => void;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { field } = props;
  const options = field.kind === "group" ? props.groups : field.options;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{field.label}</Text>
      {field.kind === "choice" || field.kind === "group" ? (
        <ChoiceList options={options} value={props.value} onChange={props.onChange} />
      ) : (
        <TextInput
          style={[styles.input, field.kind === "code" && styles.code]}
          value={props.value}
          onChangeText={props.onChange}
          placeholder={field.placeholder}
          placeholderTextColor={textColors.placeholderText}
          autoCapitalize={field.kind === "code" ? "none" : "sentences"}
          autoCorrect={field.kind !== "code"}
          spellCheck={field.kind !== "code"}
          multiline={field.kind === "code" && field.id === "command"}
        />
      )}
    </View>
  );
};

/**
 * A form in a slide-up sheet. `group` starts a `group` field on the group the
 * user is looking at. `onSubmit` rejecting keeps the sheet open with why.
 */
export const FormSheet = (props: {
  readonly spec: FormSpec | undefined;
  readonly groups: ReadonlyArray<GroupOption>;
  readonly group?: string;
  readonly onCancel: () => void;
  readonly onSubmit: (values: Readonly<Record<string, string>>) => Promise<void>;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // The theme's background (Appearance → Background): a sheet is its own
  // window, outside the navigator that paints the screens.
  const background = useScreenBackground();
  const { spec } = props;
  const [values, setValues] = React.useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  // A new form starts from its own values.
  React.useEffect(() => {
    if (spec === undefined) return;
    setValues(startingValues(spec, props.group));
    setError(undefined);
    setBusy(false);
  }, [spec, props.group]);

  const submit = (): void => {
    setBusy(true);
    setError(undefined);
    props.onSubmit(values).then(
      () => setBusy(false),
      (cause: unknown) => {
        setBusy(false);
        setError(messageOf(cause));
      },
    );
  };

  return (
    <Modal visible={spec !== undefined} animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onCancel}>
      {spec === undefined ? null : (
        <View style={[styles.sheet, { backgroundColor: background }]}>
          <SheetBar title={spec.title} action={spec.submitTitle} busy={busy} onCancel={props.onCancel} onAction={submit} />
          <ScrollView contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
            {error === undefined ? null : <Text style={styles.error}>{error}</Text>}
            {spec.fields.map((field) => (
              <Field
                key={field.id}
                field={field}
                value={values[field.id] ?? ""}
                groups={props.groups}
                onChange={(value) =>
                  setValues((current) => ({
                    ...current,
                    [field.id]: value,
                  }))
                }
              />
            ))}
          </ScrollView>
        </View>
      )}
    </Modal>
  );
};

/** What a category's row shows for the scripts being sorted, and what a tap
 * makes it: all in (check), none (empty), or left as they were (dash). */
const nextChoice = (current: boolean | undefined, standing: "all" | "none" | "some"): boolean => {
  const allIn = current ?? standing === "all";
  return !allIn;
};

/**
 * Put scripts in and out of categories. `onSave` gets each category the user
 * changed, on or off; untouched ones stay as each script had them.
 * `onCreate` makes a category and answers its id, which starts checked.
 */
export const CategoriesSheet = (props: {
  readonly items: ReadonlyArray<CollectionItem> | undefined;
  readonly categories: ReadonlyArray<Category>;
  readonly state: CollectionState;
  readonly onCancel: () => void;
  readonly onCreate: (name: string) => Promise<string | undefined>;
  readonly onSave: (choices: ReadonlyMap<string, boolean>) => Promise<void>;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const insets = useSafeAreaInsets();
  const background = useScreenBackground();
  const { items } = props;
  const [choices, setChoices] = React.useState<ReadonlyMap<string, boolean>>(new Map());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    setChoices(new Map());
    setError(undefined);
    setBusy(false);
  }, [items]);

  const run = (work: Promise<void>): void => {
    setBusy(true);
    setError(undefined);
    work.then(
      () => setBusy(false),
      (cause: unknown) => {
        setBusy(false);
        setError(messageOf(cause));
      },
    );
  };

  const create = (): void =>
    Alert.prompt("Add Category", undefined, (name) =>
      run(
        props.onCreate(name).then((id) => {
          if (id !== undefined) setChoices((current) => new Map([...current, [id, true]]));
        }),
      ),
    );

  const count = items?.length ?? 0;
  return (
    <Modal visible={items !== undefined} animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onCancel}>
      {items === undefined ? null : (
        <View style={[styles.sheet, { backgroundColor: background }]}>
          <SheetBar title={count === 1 ? "Categories" : `Categories for ${count} Scripts`} action="Save" busy={busy} onCancel={props.onCancel} onAction={() => run(props.onSave(choices))} />
          <ScrollView contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + 24 }]}>
            {error === undefined ? null : <Text style={styles.error}>{error}</Text>}
            <View style={styles.card}>
              <CardGlass />
              {props.categories.map((category, index) => {
                const standing = membership(items, category.id, props.state);
                const choice = choices.get(category.id);
                const shown = choice === undefined ? standing : choice ? "all" : "none";
                return (
                  <Pressable
                    key={category.id}
                    style={[styles.choice, index > 0 && styles.rowBorder]}
                    onPress={() => setChoices((current) => new Map([...current, [category.id, nextChoice(current.get(category.id), standing)]]))}
                  >
                    <SystemIcon name={symbolForIcon(category.icon)} size={17} color={colors.tint} />
                    <Text style={styles.choiceLabel}>{category.name}</Text>
                    {shown === "all" ? (
                      <SystemIcon name="checkmark" size={15} color={colors.tint} />
                    ) : shown === "some" ? (
                      <SystemIcon name="minus" size={15} color={textColors.secondaryLabel} />
                    ) : null}
                  </Pressable>
                );
              })}
              <Pressable style={[styles.choice, props.categories.length > 0 && styles.rowBorder]} onPress={create}>
                <SystemIcon name="plus" size={17} color={colors.tint} />
                <Text style={[styles.choiceLabel, styles.tinted]}>Add Category…</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      )}
    </Modal>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
  sheet: {
    flex: 1,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  barTitle: {
    flex: 1,
    textAlign: "center",
    color: text.label,
    fontSize: 17,
    fontWeight: "600",
  },
  barButton: {
    color: colors.tint,
    fontSize: 17,
  },
  barAction: {
    fontWeight: "600",
  },
  sheetContent: {
    paddingHorizontal: 16,
    gap: 18,
  },
  error: {
    color: colors.destructive,
    fontSize: 14,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: text.secondaryLabel,
    fontSize: 13,
    textTransform: "uppercase",
    marginLeft: 4,
  },
  input: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: text.label,
    fontSize: 16,
  },
  code: {
    fontFamily: "Menlo",
    fontSize: 14,
  },
  card: {
    borderRadius: 14,
  },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  choiceLabel: {
    flex: 1,
    color: text.label,
    fontSize: 16,
  },
  tinted: {
    color: colors.tint,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
});
