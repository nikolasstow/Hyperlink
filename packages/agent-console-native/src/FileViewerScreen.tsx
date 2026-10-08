/**
 * A file on its own, outside Files: opened from a plugin or an extension
 * (followResult.ts) or a chat. The file itself is `FileView`.
 *
 * @internal
 */
import * as React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { FileView } from "./files/FileView";
import type { RootStackParamList } from "./RootNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "FileViewer">;

export const FileViewerScreen = (props: Props): React.ReactElement => {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { path, name, line } = props.route.params;
  return (
    <View style={styles.root}>
      <FileView path={path} name={name} {...(line === undefined ? {} : { line })} topInset={headerHeight} bottomInset={insets.bottom} />
      <EdgeBlurBars variant="top" />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
