/**
 * Projects: the owner's ongoing work as a list from Home's menu, each project
 * with its pages (artifacts) under it, by category, pinned first. A page
 * opens in ProjectPageScreen as the server renders it, `window.da` included.
 *
 * Nothing is kept on the phone: the page loads the projects and their pages
 * from the server each time it opens (a skeleton while it does).
 *
 * @internal
 */
import type { Projects } from "agent-console-protocol";
import * as React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ScrollViewMarker } from "react-native-screens/src/components/gamma/scroll-view-marker";
import { useAppContext } from "./AppContext";
import { CARD_RADIUS, CardGlass } from "./CardGlass";
import { colors } from "./colors";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { listPages, listProjects } from "./projectsClient";
import type { RootStackParamList } from "./RootNavigator";
import { SkeletonList } from "./Skeleton";
import { SystemIcon } from "./SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "Projects">;

type Loaded = {
  readonly projects: ReadonlyArray<Projects.Project>;
  readonly pages: ReadonlyMap<string, ReadonlyArray<Projects.PageMeta>>;
};

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly loaded: Loaded }
  | { readonly kind: "failed"; readonly message: string };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Projects grouped by category, in the order the server sorted them. */
const byCategory = (projects: ReadonlyArray<Projects.Project>): ReadonlyArray<readonly [string, ReadonlyArray<Projects.Project>]> => {
  const groups = new Map<string, Array<Projects.Project>>();
  for (const project of projects) {
    const group = groups.get(project.category) ?? [];
    group.push(project);
    groups.set(project.category, group);
  }
  return [...groups.entries()];
};

const load = async (apiBase: string): Promise<Loaded> => {
  const projects = await listProjects(apiBase);
  const lists = await Promise.all(
    projects.map((project) =>
      listPages(apiBase, project.slug).catch((): ReadonlyArray<Projects.PageMeta> => []),
    ),
  );
  return {
    projects,
    pages: new Map(projects.map((project, index) => [project.slug, lists[index] ?? []])),
  };
};

export const ProjectsScreen = (props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { server: apiBase } = useAppContext();
  const headerHeight = useHeaderHeight();
  const [state, setState] = React.useState<Load>({ kind: "loading" });
  const [refreshing, setRefreshing] = React.useState(false);

  const fetchAll = React.useCallback(async (): Promise<void> => {
    try {
      const loaded = await load(apiBase);
      setState({ kind: "ready", loaded });
    } catch (error) {
      setState({ kind: "failed", message: messageOf(error) });
    }
  }, [apiBase]);

  React.useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const openPage = (project: Projects.Project, page: Projects.PageMeta): void => {
    props.navigation.push("ProjectPage", {
      project: project.slug,
      slug: page.slug,
      title: page.title,
    });
  };

  if (state.kind === "loading") {
    return (
      <View style={styles.root}>
        <SkeletonList top={headerHeight} rows={4} />
      </View>
    );
  }

  if (state.kind === "failed") {
    return (
      <View style={[styles.root, styles.center, { paddingTop: headerHeight + 40 }]}>
        <Text style={styles.message}>Couldn’t load the projects.</Text>
        <Text style={styles.detail}>{state.message}</Text>
        <TouchableOpacity onPress={() => void fetchAll()}>
          <Text style={styles.retry}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { projects, pages } = state.loaded;

  return (
    <View style={styles.root}>
      <ScrollViewMarker style={styles.fill} scrollEdgeEffects={{ top: "soft", bottom: "soft" }}>
        <ScrollView
          contentContainerStyle={{ paddingTop: headerHeight + 8, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void fetchAll().finally(() => setRefreshing(false));
              }}
              tintColor={textColors.secondaryLabel}
            />
          }
        >
          {projects.length === 0 ? <Text style={styles.empty}>No projects yet. An agent makes one with `da projects add`.</Text> : null}
          {byCategory(projects).map(([category, group]) => (
            <View key={category} style={styles.section}>
              <Text style={styles.sectionLabel}>{category}</Text>
              {group.map((project) => {
                const projectPages = pages.get(project.slug) ?? [];
                return (
                  <View key={project.slug} style={styles.card}>
                    <CardGlass />
                    <View style={styles.cardHead}>
                      {project.pinned ? <SystemIcon name="pin.fill" size={12} color={textColors.secondaryLabel} /> : null}
                      <Text style={styles.cardName} numberOfLines={1}>
                        {project.name}
                      </Text>
                    </View>
                    {project.description.length > 0 ? (
                      <Text style={styles.cardDescription} numberOfLines={2}>
                        {project.description}
                      </Text>
                    ) : null}
                    {projectPages.length === 0 ? (
                      <Text style={styles.cardEmpty}>No pages yet.</Text>
                    ) : (
                      projectPages.map((page) => (
                        <TouchableOpacity key={page.slug} style={styles.pageRow} onPress={() => openPage(project, page)}>
                          <SystemIcon name="doc.text" size={16} color={textColors.secondaryLabel} />
                          <Text style={styles.pageTitle} numberOfLines={1}>
                            {page.title}
                          </Text>
                          <Text style={styles.pageMeta}>{page.author}</Text>
                          <SystemIcon name="chevron.right" size={12} color={textColors.secondaryLabel} />
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </ScrollViewMarker>
      <EdgeBlurBars variant="top" />
    </View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
    },
    fill: {
      flex: 1,
    },
    center: {
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 24,
    },
    section: {
      marginBottom: 18,
    },
    sectionLabel: {
      color: text.secondaryLabel,
      fontSize: 13,
      textTransform: "uppercase",
      marginBottom: 8,
      marginHorizontal: 16,
    },
    card: {
      marginHorizontal: 16,
      marginBottom: 10,
      padding: 14,
      borderRadius: CARD_RADIUS,
      overflow: "hidden",
    },
    cardHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    cardName: {
      color: text.label,
      fontSize: 17,
      fontWeight: "600",
      flexShrink: 1,
    },
    cardDescription: {
      color: text.secondaryLabel,
      fontSize: 14,
      marginTop: 4,
    },
    cardEmpty: {
      color: text.secondaryLabel,
      fontSize: 13,
      marginTop: 10,
    },
    pageRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      marginTop: 6,
    },
    pageTitle: {
      color: text.label,
      fontSize: 15,
      flex: 1,
    },
    pageMeta: {
      color: text.secondaryLabel,
      fontSize: 12,
    },
    empty: {
      color: text.secondaryLabel,
      paddingHorizontal: 16,
    },
    message: {
      color: text.secondaryLabel,
      fontSize: 15,
    },
    detail: {
      color: text.secondaryLabel,
      fontSize: 12,
      fontFamily: "Menlo",
      textAlign: "center",
    },
    retry: {
      color: colors.tint,
      fontSize: 15,
      fontWeight: "600",
    },
  });
