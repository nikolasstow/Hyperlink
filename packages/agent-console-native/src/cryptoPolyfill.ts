/**
 * `crypto.getRandomValues` for Hermes, which has no WebCrypto: opencode's
 * identifiers (`src/opencode/schema/identifier.ts`, the ids the outbox gives
 * messages) draw their random part from it. Backed by expo-crypto's native
 * module, loaded optionally so a build from before it does not fail to start;
 * there, the global stays absent and making an id fails loudly.
 *
 * Imported first, from index.ts.
 *
 * @internal
 */
import { requireOptionalNativeModule } from "expo";

interface ExpoCrypto {
  readonly getRandomValues: (array: Uint8Array) => void;
}

const native = requireOptionalNativeModule<ExpoCrypto>("ExpoCrypto");

if (globalThis.crypto?.getRandomValues === undefined && native !== null) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      ...globalThis.crypto,
      getRandomValues: (array: Uint8Array): Uint8Array => {
        native.getRandomValues(array);
        return array;
      },
    },
  });
}
