/**
 * Catches render errors and shows them on screen instead of a silent blank, so
 * a failure is diagnosable rather than a black hole. Wraps the whole app.
 *
 * @internal
 */
import * as React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "./colors";

type Props = { readonly children: React.ReactNode };
type State = { readonly error: Error | undefined };

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error("[ErrorBoundary]", error);
  }

  override render(): React.ReactNode {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Something crashed</Text>
        <ScrollView style={styles.scroll}>
          <Text style={styles.message}>{error.message}</Text>
          {error.stack !== undefined ? <Text style={styles.stack}>{error.stack}</Text> : null}
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: 72,
    paddingHorizontal: 20,
  },
  title: {
    color: colors.destructive,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
  },
  scroll: {
    flex: 1,
  },
  message: {
    color: colors.label,
    fontSize: 15,
    marginBottom: 12,
  },
  stack: {
    color: colors.secondaryLabel,
    fontSize: 12,
    fontFamily: "Menlo",
  },
});
