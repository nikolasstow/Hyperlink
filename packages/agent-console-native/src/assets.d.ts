/**
 * Metro treats `.html` as an asset, so importing one yields a module id rather
 * than its text. `expo-asset` turns that id into a file on disk.
 *
 * @internal
 */
declare module "*.html" {
  const asset: number;
  export default asset;
}
