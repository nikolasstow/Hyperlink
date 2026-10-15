/** Types for variant.js (CommonJS, as Expo evaluates it); see its comments. */
export declare const variantMarkerFile: string;
export declare const variantIconFile: string;
export declare const slugify: (name: string) => string;
export declare const resolveVariant: (dir: string) => string | undefined;
export declare const appScheme: (baseScheme: string, variant: string | undefined) => string;
