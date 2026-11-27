export type InstrumentalStyle = "note" | "dots";

export const INSTRUMENTAL_STYLE_DEFAULT: InstrumentalStyle = "dots";
export const INSTRUMENTAL_STYLE_ATTR = "blyrics-instrumental-style" as const;

export function normalizeInstrumentalStyle(raw: unknown): InstrumentalStyle {
  return raw === "note" ? "note" : "dots";
}

export function readInstrumentalStyle(doc: Document | null | undefined): InstrumentalStyle {
  return doc?.documentElement?.getAttribute?.(INSTRUMENTAL_STYLE_ATTR) === "note" ? "note" : "dots";
}

/** Syncs `blyrics-instrumental-style` on `doc.documentElement` and reports whether it changed. */
export function applyInstrumentalStyleAttribute(
  doc: Document | null | undefined,
  style: InstrumentalStyle
): boolean {
  const root = doc?.documentElement;
  if (!root) return false;
  const prev = readInstrumentalStyle(doc);
  if (style === "note") {
    if (root.getAttribute(INSTRUMENTAL_STYLE_ATTR) !== "note") {
      root.setAttribute(INSTRUMENTAL_STYLE_ATTR, "note");
    }
  } else {
    root.removeAttribute(INSTRUMENTAL_STYLE_ATTR);
  }
  return prev !== style;
}
