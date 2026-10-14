import { Effect, Stream } from "effect";
import { KeyValueStore } from "effect/persistence";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodeFonts } from "./CodeFonts";

const native = vi.hoisted(() => {
  const downloads: Array<string> = [];
  return {
    registered: new Set<string>(),
    downloads,
    failing: new Set<string>(),
  };
});

vi.mock("../../modules/code-editor", () => ({
  canInstallFonts: true,
  registerFont: (uri: string) => {
    native.registered.add(uri);
    return Promise.resolve(["Family"]);
  },
  unregisterFont: (uri: string) => {
    native.registered.delete(uri);
    return Promise.resolve();
  },
}));

vi.mock("expo-file-system", () => {
  class Directory {
    readonly exists = true;
    create(): void {}
  }
  class File {
    readonly uri: string;
    readonly exists = true;
    constructor(...parts: Array<unknown>) {
      this.uri = `file:///docs/${parts.filter((part): part is string => typeof part === "string").join("/")}`;
    }
    delete(): void {}
    static downloadFileAsync(address: string, destination: File): Promise<File> {
      if (native.failing.has(address)) return Promise.reject(new Error("offline"));
      native.downloads.push(address);
      return Promise.resolve(destination);
    }
  }
  return { Directory, File, Paths: { document: "docs" } };
});

const run = <A, E>(effect: Effect.Effect<A, E, CodeFonts>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(CodeFonts.layer), Effect.provide(KeyValueStore.layerMemory)));

const installedNow = Effect.gen(function* () {
  const fonts = yield* CodeFonts;
  return yield* fonts.changes.pipe(Stream.take(1), Stream.runCollect);
});

beforeEach(() => {
  native.registered.clear();
  native.downloads.length = 0;
  native.failing.clear();
});

describe("CodeFonts", () => {
  it("downloads and registers each listed font, from the API server", async () => {
    const installed = await run(
      Effect.gen(function* () {
        yield* (yield* CodeFonts).sync("http://server:5199", [
          { family: "Berkeley Mono", url: "/fonts/file?id=a" },
          { family: "Iosevka", url: "https://cdn.example/iosevka.ttf" },
        ]);
        return yield* installedNow;
      }),
    );
    expect(native.downloads).toEqual(["http://server:5199/fonts/file?id=a", "https://cdn.example/iosevka.ttf"]);
    expect([...(installed[0]?.keys() ?? [])].sort()).toEqual(["Berkeley Mono", "Iosevka"]);
    expect(native.registered.size).toBe(2);
  });

  it("downloads a font once, and removes one no longer listed", async () => {
    await run(
      Effect.gen(function* () {
        const fonts = yield* CodeFonts;
        yield* fonts.sync("http://server", [
          { family: "A", url: "/a" },
          { family: "B", url: "/b" },
        ]);
        yield* fonts.sync("http://server", [{ family: "A", url: "/a" }]);
      }),
    );
    expect(native.downloads).toEqual(["http://server/a", "http://server/b"]);
    expect([...native.registered]).toEqual(["file:///docs/A.font"]);
  });

  it("leaves a font that fails out, to try again next time", async () => {
    native.failing.add("http://server/b");
    const installed = await run(
      Effect.gen(function* () {
        const fonts = yield* CodeFonts;
        yield* fonts.sync("http://server", [
          { family: "A", url: "/a" },
          { family: "B", url: "/b" },
        ]);
        native.failing.clear();
        yield* fonts.sync("http://server", [
          { family: "A", url: "/a" },
          { family: "B", url: "/b" },
        ]);
        return yield* installedNow;
      }),
    );
    expect(native.downloads).toEqual(["http://server/a", "http://server/b"]);
    expect([...(installed[0]?.keys() ?? [])].sort()).toEqual(["A", "B"]);
  });

  it("registers the kept fonts again at launch", async () => {
    const installed = await run(
      Effect.gen(function* () {
        const fonts = yield* CodeFonts;
        yield* fonts.sync("http://server", [{ family: "A", url: "/a" }]);
        native.registered.clear();
        yield* fonts.readBack;
        return yield* installedNow;
      }),
    );
    expect([...native.registered]).toEqual(["file:///docs/A.font"]);
    expect([...(installed[0]?.keys() ?? [])]).toEqual(["A"]);
  });
});
