// src/tools/pdf-editor/fonts.ts
export type FontClass = "serif" | "sans" | "mono";

export const DEFAULT_FONT_CLASS: FontClass = "sans";

const MONO = ["courier", "consol", "menlo", "monaco", "lucidaconsole", "liberationmono", "dejavusansmono", "sourcecode", "fira", "inconsolata"];
const SERIF = ["times", "georgia", "garamond", "serif", "liberationserif", "timesnewroman", "cambria", "constantia", "bookantiqua", "palatino"];
const SANS = ["helvetica", "arial", "calibri", "verdana", "tahoma", "segoe", "roboto", "opensans", "lato", "montserrat", "liberationsans", "nunito", "sans"];

function normalize(name: string): string {
  const stripped = name.includes("+") ? name.slice(name.indexOf("+") + 1) : name;
  return stripped.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function classifyFont(baseFontName: string): FontClass {
  const n = normalize(baseFontName);
  if (MONO.some((k) => n.includes(k))) return "mono";
  if (SERIF.some((k) => n.includes(k))) return "serif";
  if (SANS.some((k) => n.includes(k))) return "sans";
  return DEFAULT_FONT_CLASS;
}

export function mostCommon(classes: FontClass[]): FontClass {
  if (classes.length === 0) return DEFAULT_FONT_CLASS;
  const tally = new Map<FontClass, number>();
  for (const c of classes) tally.set(c, (tally.get(c) ?? 0) + 1);
  let best: FontClass = DEFAULT_FONT_CLASS;
  let bestCount = -1;
  for (const [cls, count] of tally) {
    if (count > bestCount) {
      best = cls;
      bestCount = count;
    }
  }
  return best;
}
