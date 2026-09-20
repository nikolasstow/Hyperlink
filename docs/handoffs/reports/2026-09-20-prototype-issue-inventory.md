# Agent report: prototype issue inventory

**Scope:** every open issue held by the prototype agent, after PR #87 merged to
`app/double-agent/ios` at `a3bd389e`.
**Split:** issues in the iOS trunk agent's area were routed to
[`ios-trunk-followups-handoff.md`](../ios-trunk-followups-handoff.md) and are not repeated
here.
**Status:** section A is fixed on `fix/toolkit-typecheck`. B2, B3, B4, B5 and B8 are fixed on
`fix/theme-editor-followups`, reported in
[the follow-ups report](./2026-09-20-theme-editor-followups.md). B6 was assessed and left
alone. B1 and B7 are open. Sections C, D and E are open.

## Before acting on this report

1. **Confirm before acting.** List the concrete actions you will take and wait for owner
   confirmation before changing code. This report is not a go.
2. **Review standards.** Read `docs/standards/` if you have not recently, at least Agent Rules,
   Principles, and the chapters touching your work. Nothing here overrides a locked standard.

## A. The toolkit gate keeps `pnpm verify` red

`pnpm verify` fails on the clean base, and did before any prototype branch existed. Eight
errors, all outside both apps. Two of the three I reported earlier had the wrong root cause,
corrected below.

### A1. `examples/ui/file-router/api.ts:78`, TS2352 (fixed)

```ts
export const destinationsOf = (): ReadonlyArray<ProtoRoute> =>
  fileEntries.map(
    (entry) => Route.get(entry.id, entry.routePath) as ProtoRoute,
  );
```

`Route.get` returns an `HttpApiEndpoint<…> & PageEndpointBrand`, which does not overlap
`ProtoRoute`, so the single-step cast is rejected. Line 94 of the same file already writes
`as unknown as AsRoutesEffect<ProtoRoute>` for the same family of conversion, so matching it
is a two-word change with precedent in place.

That is the cheap fix, not the right one. `boundary-cast-last-resort` points at removing the
cast: type `destinationsOf` from what `Route.get` actually returns, and let the brand flow
to the caller. This file is a prototype whose own doc comment says a real implementation
would discover routes from a directory, so the cast is holding a shape that is going to be
replaced. Worth ten minutes to find out which fix survives that replacement.

### A2. `test/document-provide.test-d.ts:24` and `:30`, TS2345 (fixed)

The earlier report called these a question about what `Document.provide`'s type-level
contract should say. That was wrong. The mechanism is positional:

```ts
// @ts-expect-error incomplete provide is not Layer<Cell>      <- line 21
const _incomplete: Layer.Layer<Document.Cell> = Document.provide(  // line 22
  Document.Default,                                                // line 23
  Document.lang("en"),                                             // line 24  <- error lands here
);
```

`@ts-expect-error` suppresses diagnostics on the line immediately following it. TypeScript
reports argument assignability at the argument node, which is two lines further down, so the
directive covers nothing and the expected error is reported as a real one. The parameter
type in the message confirms the contract is behaving exactly as the test intends: it
carries `_error: "Document.provide: incomplete"` and `missing: "title" | "titleTransform"`.

Collapsing each of the two calls onto the line directly under its directive fixes both, with
no change to `Document.provide` and no decision to make.

### A3. Five `TS28` diagnostics in `packages/last-ts` (fixed)

`internal/lastLink.tsx:399,404,410` and `internal/routerBuilder.tsx:282,523`, all reading
"has unknown in the requirements channel and unknown in the error channel which is not
recommended". Each sits in an overload-erasure seam with a comment above it explaining why
`Layer.isLayer` cannot preserve E and R and why the overloads already checked what the
narrowing loses.

The code is deliberate and documented in place, and `tsgo` over the same project reports none
of it, so the disagreement was between the two checkers the gate runs rather than between the
code and the rules. Both predicates narrow to a type whose error and requirements channels are
`unknown` or `any`, and in each case the next line restates those channels from the overload
contract, so the narrowing contributed nothing that survived. `isLinkLayer` and `isPageEffect`
keep the runtime check and drop the narrowing, and the cast sits once in a helper beside each
rather than in three copies. `RouterBuilder.layer` pins `resolveApi`'s requirements at the
yield, matching the seam `routes.ts:1260` already used.

### A4. 652 `TS377032` diagnostics drown the output

`strictEffectProvide` fires at message severity, so it fails nothing, and it buries the eight
errors above under six hundred lines. Two ways out: lower the rule in the
`@effect/language-service` plugin block in `tsconfig.json`, or filter message-severity
diagnostics in the `hyp typecheck` reporter. The reporter filter keeps the hints live in the
editor, where they help, and out of the gate, where they do not. Confirm the plugin's
severity key against the installed version before writing either.

**This section is the highest priority in the report.** While `verify` is red,
`green-before-commit` is unenforceable for every agent, and the three gate holes closed in
`198aff04` have nothing stopping them reopening.

## B. Theme editor, now on the trunk

Merged at `a3bd389e`. Lint, both typechecks and 1161 tests are green on it. Nothing has run
on a device.

### B1. The `Host` recycling hazard is the first thing to test

`ThemeColorGroupScreen` renders one `ColorPicker` per row inside a scrolling list. Each
`@expo/ui` view lives in a `Host`, and
[`agent-console-native-composer.md`](../agent-console-native-composer.md) records that `Host`
initialises only on a genuine first mount. A list that recycles rows is that hazard by
construction, and a recycled picker comes back inert.

If it reproduces, the fix is to render each row as text plus a tap target and mount one
`Host`-backed picker in a sheet for the selected key. That also takes N native views out of
the list, which is the better shape regardless of what the device shows.

### B2. The picker rewrites every colour it touches (fixed, and not what this said)

This originally claimed the picker might write an unset key the moment it was opened.
`@expo/ui@57.0.13`'s `ios/ColorPickerView.swift` rules that out: `.onAppear` records the hex it
was handed and the dispatch fires only when a new hex differs from it.

The real defect was next to it. `colorToHex` formats with `#%02X%02X%02X%02X` whenever
`supportsOpacity` is on, which both screens pass, so the picker answers in eight uppercase
digits whatever it was given. A key written `#1e1e1e` came back `#1E1E1EFF` on the first edit,
and a theme imported and edited in one place came out differing on keys nobody touched.
`normalizePickedColor` reads the value back into the key's own notation.

### B3. The "unset" key list is synthesised, not real (fixed)

`ThemeColorGroupScreen` builds its Add list from patterns like `${prefix}.background` rather
than a registry, so it offers keys VS Code does not define and omits keys it does. Fix:
generate a checked-in `vscodeColorKeys.ts` with the generator committed beside it. The union
of keys across the themes bundled with `shiki` is available offline and covers most of the
surface; VS Code's own colour registry is the authoritative list if vendoring it is
acceptable.

### B4. A theme that fails to parse is deleted, permanently (fixed)

`createdThemes.ts:39` drops a row `toCreatedTheme` cannot parse, and `write` at line 79
persists whatever `listCreatedThemes` returned. So one unparseable theme is skipped on read
and erased from storage by the next save of any other theme. This is the one item in section
B that is a bug rather than a follow-up.

Fix: carry unrecognised rows through verbatim in the written payload, or refuse to write at
all when any row failed to parse.

### B5. Saving is read-modify-write with no serialisation (fixed)

`saveCreatedTheme` calls `listCreatedThemes`, which re-parses every stored theme, then writes
the whole list back. Two saves in flight race, and the loser is lost. Fix: an in-memory list
as the source of truth with a serialised write behind it, matching `settings.ts`.

### B6. Token rules are addressed by array index (assessed, left alone)

`ThemeTokenRuleScreen` takes `route.params.index` and the import scheme uses
`tokens:<index>`, so a delete or an insert shifts every index after it.

Checked against what the editor can actually do: nothing reorders `tokenColors`, the list
screen only appends, `applyImport` appends, and deletion happens on the rule screen which pops
straight after. No sequence produces the failure. A stable id would have to live either in the
document model, which is the VS Code format and not ours to extend, or in a second array
inside the draft kept in step with the first. Neither earns its keep against a bug nothing can
reach, so this is recorded as a constraint: anything that reorders or inserts rules has to
bring ids with it.

### B7. Created themes do not sync

They live in AsyncStorage and stay on the device. The server keeps a synced `config`
document, described as small and last-write-wins. A full theme is a few hundred keys. Whether
that document should carry them is the question to answer before building anything.

### B8. No Duplicate on an installed theme (fixed)

Editing a stock theme is create followed by import. A Duplicate action makes it two taps.
Pure addition, no risk, smallest item here.

## C. Builds screen, `app/double-agent/builds`, PR #82

### C1. Install opens a raw `.ipa`

iOS cannot install from a bare `.ipa` link. It needs an `itms-services://` manifest over
HTTPS, or a page that serves one. The EAS build page is that page, and its URL is derivable
from fields `/builds` already returns:
`https://expo.dev/accounts/{app.ownerAccount.name}/projects/{app.slug}/builds/{id}`. So this
is fixable in the app with no server change. Confirm the URL shape against a live build
before shipping it. Until then the Install button is misleading, which is worse than absent.

### C2. Rows carry no timestamp

Blocked on item 2 of the trunk handoff, where `asBuildRow` gains the field. Nothing to do on
the app side until it lands.

## D. Widget prototype, PR #83

### D1. The Swift has never been compiled

There is no Xcode in this environment. That PR is a design, and its description should say
so plainly rather than reading as working code.

### D2. `OpencodeClient.swift` is now a third copy

App, widget and watch targets each carry their own copy of the client, `WidgetData` and
`SessionActivityAttributes`. Before any of the three ships, one local Swift package target
they all depend on.

## E. Bus hygiene

The status board's **Providers UI** row still reads "merged into `app/double-agent/ios`".
The owner reverted that merge and the trunk carries no providers code. Corrected in the same
commit as this report.

## Order

1. Section A, so the gate means something again. A2 and A4 are mechanical, A1 needs ten
   minutes of reading, A3 is an owner call.
2. B4, then B2. Both can lose or corrupt what someone typed.
3. C1, which needs no server change.
4. B1 on a device, because its outcome decides whether B3's design survives.
5. Everything else.
