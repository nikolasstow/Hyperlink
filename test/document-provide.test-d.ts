/**
 * Document.provide — incomplete required fields are not Layer<Cell>.
 */
import { expectTypeOf } from "vitest";
import { Layer } from "effect";
import * as Document from "last-ts/Document";

const complete = Document.provide(
  Document.Default,
  Document.title("last.ts"),
  Document.titleTransform((t) => t),
);
expectTypeOf(complete).toEqualTypeOf<Layer.Layer<Document.Cell>>();

const alsoObject = Document.provide(Document.Default, {
  title: "last.ts",
  titleTransform: (t: string) => t,
});
expectTypeOf(alsoObject).toEqualTypeOf<Layer.Layer<Document.Cell>>();

// @ts-expect-error incomplete provide is not Layer<Cell> — kept on one line so the
// directive covers the argument node where TS reports the assignability error.
const _incomplete: Layer.Layer<Document.Cell> = Document.provide(Document.Default, Document.lang("en"));

// @ts-expect-error title alone is incomplete (titleTransform required) — one line, same reason as above.
const _titleOnly: Layer.Layer<Document.Cell> = Document.provide(Document.Default, Document.title("x"));
