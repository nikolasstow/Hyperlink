/**
 * The file menu's font size buttons show "Aa" in the code's own font, small
 * for Smaller and large for Larger: images the native side draws in the font
 * the editor really uses, so they change with the code font and when a custom
 * one finishes installing. Drawn as the page opens (the menu's button is on
 * it), never on the tap that opens the menu.
 *
 * @internal
 */
import * as React from "react";
import { textImage } from "../../modules/code-editor";
import { useInstalledCodeFonts } from "../fonts/useCodeFonts";

/** Each image's box, and the two sizes of "Aa" in it (pt). */
const BOX = { width: 28, height: 22 };
const SMALLER = 13;
const LARGER = 19;
/** The menu's text colour in each appearance. */
const INK = { light: "#000000", dark: "#FFFFFF" };

export interface FontSizeIcons {
  readonly smaller: string;
  readonly larger: string;
}

/** The "Aa" images for `family`; undefined until drawn (and on a build that
 * cannot draw them). */
export const useFontSizeIcons = (family: string, scheme: "light" | "dark"): FontSizeIcons | undefined => {
  // Redrawn when a custom font is installed or removed, so the image is in
  // the font the editor draws in.
  const installed = useInstalledCodeFonts();
  const resolvedFamily = installed.has(family) ? `${family} (installed)` : family;
  const [icons, setIcons] = React.useState<FontSizeIcons | undefined>(undefined);
  React.useEffect(() => {
    let alive = true;
    const draw = (size: number): Promise<string | undefined> => textImage("Aa", family, size, BOX.width, BOX.height, INK[scheme]);
    Promise.all([draw(SMALLER), draw(LARGER)])
      .then(([smaller, larger]) => {
        if (alive && smaller !== undefined && larger !== undefined) setIcons({ smaller, larger });
      })
      .catch((error: unknown) => console.error("[fonts] drawing the font size icons failed", error));
    return () => {
      alive = false;
    };
  }, [family, resolvedFamily, scheme]);
  return icons;
};
