/**
 * NPM: the repo's package.json, its scripts, and its packages
 * (docs/handoffs/double-agent-repo-screen-and-plugin-system.md §23).
 *
 * - The **NPM** page (pages.ts), organized: the project, the pinned scripts,
 *   and the package manager's card; with **All Details** below it.
 * - **Scripts** (scriptsCollection.ts): every package's scripts, sorted into
 *   categories and pinned by the user.
 * - **Packages** (dependencies.ts): the workspace's dependencies, with
 *   install, update and remove, and search across the npm registry.
 *
 * @internal
 */
import { definePlugin } from "../../plugin/api";
import { dependenciesCollection } from "./dependencies";
import { detailsPage, npmPage } from "./pages";
import { scriptsCollection } from "./scriptsCollection";

export default definePlugin({
  sectionPages: {
    npm: {
      content: ({ workspace }) => npmPage(workspace),
    },
    details: {
      content: ({ workspace }) => detailsPage(workspace),
    },
  },
  collections: {
    scripts: scriptsCollection,
    packages: dependenciesCollection,
  },
});
