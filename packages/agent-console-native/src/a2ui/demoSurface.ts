/**
 * A hand-written A2UI surface for the pilot — stands in for what an agent would
 * emit. Exercises the catalog: titles, a Card of facts bound to the data model,
 * a List, a two-way TextField and ChoicePicker, and a Button whose action
 * carries the current data back. Nothing here is DA-specific — it's plain A2UI,
 * proving the renderer maps it onto the glass.
 *
 * @internal
 */
import type { A2uiSurfaceData } from "./types";

export const demoSurface: A2uiSurfaceData = {
  version: "1.0",
  surfaceId: "pilot_deploy_1",
  root: "root",
  dataModel: {
    branch: "feat/a2ui-pilot",
    commits: 3,
    message: "",
    environment: "preview",
    files: ["src/a2ui/A2uiSurface.tsx", "src/a2ui/types.ts", "docs/handoffs/a2ui-for-da.md"],
  },
  components: {
    root: { id: "root", component: "Column", children: ["heading", "facts", "changed", "msg", "env", "deploy"] },
    heading: { id: "heading", component: "Text", text: "Deploy preview", role: "title" },

    facts: { id: "facts", component: "Card", title: "Summary", children: ["branch_row", "commits_row"] },
    branch_row: { id: "branch_row", component: "Row", children: ["branch_label", "branch_value"] },
    branch_label: { id: "branch_label", component: "Text", text: "Branch", role: "label" },
    branch_value: { id: "branch_value", component: "Text", text: { "@path": "/branch" }, role: "value" },
    commits_row: { id: "commits_row", component: "Row", children: ["commits_label", "commits_value"] },
    commits_label: { id: "commits_label", component: "Text", text: "Commits", role: "label" },
    commits_value: { id: "commits_value", component: "Text", text: { "@path": "/commits" }, role: "value" },

    changed: { id: "changed", component: "List", children: ["f0", "f1", "f2"] },
    f0: { id: "f0", component: "Text", text: { "@path": "/files/0" }, role: "value" },
    f1: { id: "f1", component: "Text", text: { "@path": "/files/1" }, role: "value" },
    f2: { id: "f2", component: "Text", text: { "@path": "/files/2" }, role: "value" },

    msg: { id: "msg", component: "TextField", label: "Message", path: "/message", placeholder: "Describe this deploy…" },
    env: {
      id: "env",
      component: "ChoicePicker",
      label: "Environment",
      path: "/environment",
      options: [
        { value: "preview", label: "Preview" },
        { value: "staging", label: "Staging" },
        { value: "production", label: "Production" },
      ],
    },
    deploy: { id: "deploy", component: "Button", label: "Deploy", action: { name: "deploy" } },
  },
};
