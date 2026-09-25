// A worker thread does not inherit tsx from the parent's `--import` flags, so
// the host worker registers it here before importing its TypeScript entry.
import { register } from "tsx/esm/api";

register();
await import("./worker.ts");
