/**
 * Catches render errors and shows them on screen instead of a silent blank, so
 * a failure is diagnosable rather than a black hole. Wraps the whole app.
 *
 * @internal
 */
import * as React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "./colors";
import { mark } from "./diagnostics/launchTrail";

type Props = { readonly children: React.ReactNode };
type State = { readonly error: Error | undefined; readonly componentStack: string | undefined };

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: undefined, componentStack: undefined };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // The component stack NAMES the component that threw — the one detail the
    // bare message/stack misses (and it survives here: EAS bundles unminified
    // for Hermes). Shown below so a release crash is self-diagnosing.
    console.error("[ErrorBoundary]", error, info.componentStack);
    mark(`render error: ${error.message}\n${(info.componentStack ?? "").split("\n").slice(0, 8).join("\n")}`);
    this.setState({ componentStack: info.componentStack ?? undefined });
  }

  override render(): React.ReactNode {
    const { error, componentStack } = this.state;
    if (error === undefined) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Something crashed</Text>
        <ScrollView style={styles.scroll}>
          <Text style={styles.message}>{error.message}</Text>
          {componentStack !== undefined ? (
            <>
              <Text style={styles.heading}>Component stack</Text>
              <Text style={styles.stack}>{componentStack}</Text>
            </>
          ) : null}
          {error.stack !== undefined ? (
            <>
              <Text style={styles.heading}>JS stack</Text>
              <Text style={styles.stack}>{error.stack}</Text>
            </>
          ) : null}
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
  heading: {
    color: colors.label,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 8,
    marginBottom: 4,
  },
  stack: {
    color: colors.secondaryLabel,
    fontSize: 12,
    fontFamily: "Menlo",
  },
});
