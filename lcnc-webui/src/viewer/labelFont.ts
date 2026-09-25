// The face of every 3D text label (troika-three-text): the bundled Inter,
// the UI's own font (style.css @font-face). troika reads TTF/OTF/WOFF through
// Typr — not WOFF2, not variable axes — so the labels get the static Regular
// as a WOFF beside the UI's variable WOFF2. A label WITHOUT a font falls back
// to troika's unicode-font-resolver, which fetches fonts from
// cdn.jsdelivr.net at run time: on a machine without internet the dimension,
// probe and plane labels never rendered (found 2026-09-25; the viewer spec
// "fetches nothing from outside the gateway" guards it).
export const LABEL_FONT_URL = new URL("../assets/fonts/Inter-Regular.woff", import.meta.url).href;
