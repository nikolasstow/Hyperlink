/**
 * NPM: the repo's package.json, its scripts, and its packages
 * (docs/handoffs/double-agent-repo-screen-and-plugin-system.md §23).
 *
 * - **The NPM page** (pages.ts), for the workspace or one of its packages:
 *   the package, its packages, its pinned scripts, the package manager.
 *   With it: **Workspace Packages**, a **dependency's page**, and **Details**.
 * - **Scripts** (scriptsCollection.ts): every package's scripts, sorted into
 *   categories and pinned by the user.
 * - **Packages** (dependencies.ts): the workspace's dependencies, with
 *   install, update and uninstall, and search across the npm registry.
 *
 * @internal
 */
import { definePlugin } from "../../plugin/api";
import { dependenciesCollection } from "./dependencies";
import { dependencyPage, detailsPage, npmPage, workspacePage } from "./pages";
import { scriptsCollection } from "./scriptsCollection";

export default definePlugin({
  sectionPages: {
    npm: {
      content: ({ workspace, params }) => npmPage(workspace, params),
    },
    workspace: {
      content: ({ workspace }) => workspacePage(workspace),
    },
    dependency: {
      content: ({ workspace, params }) => dependencyPage(workspace, params),
    },
    details: {
      content: ({ workspace, params }) => detailsPage(workspace, params),
    },
  },
  collections: {
    scripts: scriptsCollection,
    packages: dependenciesCollection,
  },
});
