/**
 * A short name for a long text (FNV-1a): cache keys for what was computed
 * from it. Not cryptographic; a collision costs at most a recompute.
 *
 * @internal
 */
export const textHash = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};
