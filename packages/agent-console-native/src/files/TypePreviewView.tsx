/**
 * The type preview, as it shows under the breadcrumbs when their glass is open
 * (BreadcrumbPill): the type's code, coloured by the code theme in the code
 * font, then its docs. A set height; longer content scrolls.
 *
 * @internal
 */
import * as React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { CodeBlock } from "../CodeBlock";
import { Markdown } from "../Markdown";
import { useTextColors, useTheme } from "../theme";
import { useCodeTheme } from "../useCodeTheme";
import type { TypePreview } from "./useTypePreview";

/** Its side margins, inside the glass. */
const SIDE = 18;

export const TypePreviewView = (props: { readonly preview: TypePreview; readonly width: number; readonly height: number }): React.ReactElement => {
  const textColors = useTextColors();
  const theme = useCodeTheme();
  const { theme: appTheme } = useTheme();
  const { preview } = props;
  return (
    <ScrollView style={{ height: props.height }} contentContainerStyle={styles.content}>
      {preview.kind === "loading" ? (
        <Text style={[styles.note, { color: textColors.secondaryLabel }]}>Reading the type…</Text>
      ) : preview.kind === "none" ? (
        <Text style={[styles.note, { color: textColors.secondaryLabel }]}>No type here.</Text>
      ) : (
        <>
          {preview.parts.code.map((block, index) => (
            <View key={`code${index}`} style={styles.code}>
              <CodeBlock code={block.text} lang={block.lang} theme={theme} fontFamily={appTheme.codeFont} />
            </View>
          ))}
          {preview.parts.docs === "" ? null : <Markdown text={preview.parts.docs} width={props.width - SIDE * 2} />}
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SIDE,
    paddingBottom: 14,
    gap: 10,
  },
  code: {
    borderRadius: 10,
    overflow: "hidden",
  },
  note: {
    fontSize: 14,
    paddingTop: 4,
  },
});
