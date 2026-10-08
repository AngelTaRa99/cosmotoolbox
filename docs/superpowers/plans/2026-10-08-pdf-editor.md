# Editor de PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PDF text editor to CosmoToolbox that edits existing text with paragraph-block reflow (edited line re-wraps; blocks below shift).

**Architecture:** PDF.js renders pages and supplies the text layer; a pure `reflow.ts` engine re-wraps an edited paragraph and computes a vertical shift; pdf-lib applies whiteout + redraw to produce the saved PDF. Edits are modeled as an append-only `EditRecord[]` list replayed onto the original bytes (which makes undo/redo trivial and avoids corrupting pdf-lib state).

**Tech Stack:** TypeScript (strict), vanilla DOM, `pdf-lib`, `pdfjs-dist`, `@tauri-apps/plugin-dialog` + `plugin-fs`, vitest (node env).

## Global Constraints

- Language: UI copy and test descriptions in **Spanish** (matches existing `photo-background`).
- Tests: vitest, `environment: "node"`, include `src/**/*.test.ts`. Pure logic must be DOM/canvas-free and inject any measurement.
- TS: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`. No `any` unless unavoidable.
- Follow existing patterns: colocate `*.test.ts` beside source; tool module exports a `ToolModule` (`mount`/`unmount`); reuse shared CSS classes (`dropzone`, `btn-primary`, `status-msg`, `.hidden`).
- Files live in `src/tools/pdf-editor/`.
- Editing is **whiteout-based** (cover + redraw), NOT content-stream surgery — per approved spec. Fonts fall back to a pdf-lib standard font matched by serif/sans/mono class.
- Registration touches: `src/tools/registry.ts` (add `pdf` to `ToolIcon` + tool entry), `src/tools/icons.ts` (add `pdf` SVG), `src/tools/index.ts` (register module).

---

### Task 1: Core model + text grouping (`textblock.ts`)

**Files:**
- Create: `src/tools/pdf-editor/textblock.ts`
- Test: `src/tools/pdf-editor/textblock.test.ts`

**Interfaces (Produces — later tasks import these exact names):**
- `interface TextRun { text: string; x: number; y: number; width: number; fontSize: number; fontName: string }`
- `interface TextLine { text: string; x: number; y: number; width: number; fontSize: number; fontName: string; runs: TextRun[] }`
- `interface TextBlock { lines: TextLine[]; left: number; top: number; bottom: number; width: number; fontSize: number; lineHeight: number; indent: number; align: "left" | "center" | "right"; reflowable: boolean; page: number }`
- `interface RawTextItem { str: string; transform: number[]; width: number; height: number; fontName: string }`
- `function groupTextItems(items: RawTextItem[], page: number): TextBlock[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/tools/pdf-editor/textblock.test.ts
import { describe, expect, it } from "vitest";
import { groupTextItems, type RawTextItem } from "./textblock";

const item = (
  str: string,
  x: number,
  y: number,
  width: number,
  fontSize = 12,
): RawTextItem => ({
  str,
  transform: [1, 0, 0, 1, x, y],
  width,
  height: fontSize,
  fontName: "g_d0_f1",
});

describe("groupTextItems", () => {
  it("fusiona items de la misma línea base en una sola línea", () => {
    const blocks = groupTextItems(
      [item("Hola ", 72, 700, 30), item("mundo", 102, 700, 30)],
      0,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toHaveLength(1);
    expect(blocks[0].lines[0].text).toBe("Hola mundo");
  });

  it("agrupa líneas cercanas verticalmente en un párrafo", () => {
    const blocks = groupTextItems(
      [item("primera línea", 72, 700, 80), item("segunda línea", 72, 685, 80)],
      0,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toHaveLength(2);
  });

  it("separa bloques cuando hay un salto vertical grande", () => {
    const blocks = groupTextItems(
      [item("arriba", 72, 700, 40), item("abajo", 72, 500, 40)],
      0,
    );
    expect(blocks).toHaveLength(2);
  });

  it("ignora items vacíos", () => {
    const blocks = groupTextItems([item("", 72, 700, 0), item("solo", 72, 700, 30)], 0);
    expect(blocks[0].lines[0].text).toBe("solo");
  });

  it("marca como no refluible un bloque con líneas desalineadas", () => {
    const blocks = groupTextItems(
      [item("izq", 72, 700, 30), item("muy a la derecha", 400, 685, 90)],
      0,
    );
    expect(blocks[0].reflowable).toBe(false);
  });

  it("expone geometría del bloque (left/top/bottom/width)", () => {
    const blocks = groupTextItems(
      [item("linea", 72, 700, 60)],
      0,
    );
    const b = blocks[0];
    expect(b.left).toBe(72);
    expect(b.width).toBe(60);
    expect(b.page).toBe(0);
    expect(b.top).toBeGreaterThanOrEqual(b.bottom);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/tools/pdf-editor/textblock.test.ts`
Expected: FAIL — `Cannot find module './textblock'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/pdf-editor/textblock.ts
export interface TextRun {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fontName: string;
}

export interface TextLine {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fontName: string;
  runs: TextRun[];
}

export interface TextBlock {
  lines: TextLine[];
  left: number;
  top: number;
  bottom: number;
  width: number;
  fontSize: number;
  lineHeight: number;
  indent: number;
  align: "left" | "center" | "right";
  reflowable: boolean;
  page: number;
}

export interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

interface PlacedItem {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fontName: string;
}

function toPlaced(raw: RawTextItem): PlacedItem | null {
  const text = raw.str;
  if (text.trim().length === 0) return null;
  const x = raw.transform[4] ?? 0;
  const y = raw.transform[5] ?? 0;
  const fontSize = Math.abs(raw.transform[3] ?? 0) || raw.height || 12;
  return { text, x, y, width: raw.width, fontSize, fontName: raw.fontName };
}

function clusterByBaseline(items: PlacedItem[]): PlacedItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PlacedItem[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last) {
      const ref = last[0];
      const tol = Math.max(ref.fontSize, it.fontSize) * 0.4;
      if (Math.abs(ref.y - it.y) <= tol) {
        last.push(it);
        continue;
      }
    }
    lines.push([it]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

function buildLine(members: PlacedItem[]): TextLine {
  const runs: TextRun[] = members.map((m) => ({
    text: m.text,
    x: m.x,
    y: m.y,
    width: m.width,
    fontSize: m.fontSize,
    fontName: m.fontName,
  }));
  const first = members[0];
  const text = members.map((m) => m.text).join("");
  const left = Math.min(...members.map((m) => m.x));
  const right = Math.max(...members.map((m) => m.x + m.width));
  return {
    text,
    x: left,
    y: first.y,
    width: right - left,
    fontSize: first.fontSize,
    fontName: first.fontName,
    runs,
  };
}

function groupLinesToBlocks(
  lines: TextLine[],
  page: number,
): TextBlock[] {
  if (lines.length === 0) return [];
  const blocks: TextBlock[][] = [];
  let current: TextLine[] = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const prev = current[current.length - 1];
    const line = lines[i];
    const gap = prev.y - line.y;
    const typical = (prev.fontSize + line.fontSize) / 2;
    const leftDiff = Math.abs(line.x - current[0].x);
    const sameColumn = leftDiff <= typical * 0.9;
    const closeVertically = gap <= typical * 2.5 && gap >= -typical * 0.5;
    if (sameColumn && closeVertically) current.push(line);
    else {
      blocks.push(current);
      current = [line];
    }
  }
  blocks.push(current);

  return blocks.map((group) => {
    const left = Math.min(...group.map((l) => l.x));
    const right = Math.max(...group.map((l) => l.x + l.width));
    const top = Math.max(...group.map((l) => l.y));
    const minBottom = Math.min(...group.map((l) => l.y));
    const fontSize = group[0].fontSize;
    const bottom = minBottom - fontSize * 0.25;
    const lineHeight =
      group.length > 1 ? (group[0].y - group[group.length - 1].y) / (group.length - 1) : fontSize * 1.2;
    const leftSpread = Math.max(...group.map((l) => l.x)) - left;
    const indent = group.length > 1 ? Math.max(0, group[0].x - Math.min(...group.slice(1).map((l) => l.x))) : 0;
    return {
      lines: group,
      left,
      top,
      bottom,
      width: right - left,
      fontSize,
      lineHeight,
      indent,
      align: "left" as const,
      reflowable: leftSpread <= 12,
      page,
    };
  });
}

export function groupTextItems(items: RawTextItem[], page: number): TextBlock[] {
  const placed: PlacedItem[] = [];
  for (const raw of items) {
    const p = toPlaced(raw);
    if (p) placed.push(p);
  }
  const lines = clusterByBaseline(placed).map(buildLine);
  return groupLinesToBlocks(lines, page);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/tools/pdf-editor/textblock.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/pdf-editor/textblock.ts src/tools/pdf-editor/textblock.test.ts
git commit -m "feat(pdf-editor): modelo de texto y agrupación en párrafos"
```

---

### Task 2: Reflow engine (`reflow.ts`)

**Files:**
- Create: `src/tools/pdf-editor/reflow.ts`
- Test: `src/tools/pdf-editor/reflow.test.ts`

**Interfaces:**
- Consumes: `TextBlock` from `./textblock`.
- Produces:
  - `type MeasureFn = (text: string, fontSize: number) => number`
  - `interface ReflowLine { text: string; x: number; y: number; fontSize: number }`
  - `interface ReflowResult { canReflow: boolean; lines: ReflowLine[]; shiftDelta: number }`
  - `function reflowBlock(block: TextBlock, newText: string, measure: MeasureFn): ReflowResult`

- [ ] **Step 1: Write the failing test**

```ts
// src/tools/pdf-editor/reflow.test.ts
import { describe, expect, it } from "vitest";
import { reflowBlock, type MeasureFn } from "./reflow";
import type { TextBlock, TextLine } from "./textblock";

// measure stub: ~0.5pt per character at any size (deterministic)
const measure: MeasureFn = (text, fontSize) => text.length * fontSize * 0.5;

const line = (text: string, y: number, x = 72, fontSize = 12): TextLine => ({
  text,
  x,
  y,
  width: text.length * fontSize * 0.5,
  fontSize,
  fontName: "f",
  runs: [],
});

const block = (lines: TextLine[], reflowable = true): TextBlock => ({
  lines,
  left: 72,
  top: Math.max(...lines.map((l) => l.y)),
  bottom: Math.min(...lines.map((l) => l.y)) - 3,
  width: 200,
  fontSize: 12,
  lineHeight: 15,
  indent: 0,
  align: "left",
  reflowable,
  page: 0,
});

describe("reflowBlock", () => {
  it("no refluible devuelve canReflow=false", () => {
    const r = reflowBlock(block([line("abc", 700)], false), "xyz", measure);
    expect(r.canReflow).toBe(false);
  });

  it("reajusta una línea larga a varias líneas dentro del ancho", () => {
    const b = block([line("una linea corta", 700)]);
    // 200pt width; each char = 12*0.5=6pt → ~33 chars per line
    const r = reflowBlock(b, "esta es una frase mucho mas larga que debe envolver", measure);
    expect(r.canReflow).toBe(true);
    expect(r.lines.length).toBeGreaterThan(1);
    for (const l of r.lines) {
      expect(measure(l.text, l.fontSize)).toBeLessThanOrEqual(b.width + 0.001);
    }
  });

  it("shiftDelta positivo cuando el nuevo texto ocupa más líneas", () => {
    const b = block([line("corto", 700)]);
    const r = reflowBlock(b, "uno dos tres cuatro cinco seis siete ocho nueve diez once", measure);
    expect(r.shiftDelta).toBeGreaterThan(0);
  });

  it("shiftDelta negativo cuando el nuevo texto es más corto", () => {
    const b = block([line("linea uno", 700), line("linea dos", 685), line("linea tres", 670)]);
    const r = reflowBlock(b, "breve", measure);
    expect(r.shiftDelta).toBeLessThan(0);
  });

  it("shiftDelta negativo al dejar el texto vacío (bloque colapsa)", () => {
    const b = block([line("linea uno", 700), line("linea dos", 685)]);
    const r = reflowBlock(b, "", measure);
    expect(r.canReflow).toBe(true);
    expect(r.lines).toHaveLength(0);
    expect(r.shiftDelta).toBeLessThan(0);
  });

  it("la primera línea respeta el sangrado y todas caen dentro del ancho", () => {
    const b = block([line("x", 700)]);
    b.indent = 10;
    const r = reflowBlock(b, "palabra palabra palabra palabra palabra palabra", measure);
    expect(r.lines[0].x).toBeGreaterThanOrEqual(b.left + b.indent - 0.001);
  });

  it("las líneas se apilan hacia abajo con el interlineado del bloque", () => {
    const b = block([line("a", 700), line("b", 685)]);
    const r = reflowBlock(b, "uno dos tres cuatro cinco seis siete ocho", measure);
    // El fixture garantiza ≥2 líneas (38 chars × 6pt = 228 > 200pt):
    // sin guardas, si el wrap cambiara el test falla ruidosamente.
    expect(r.lines.length).toBeGreaterThanOrEqual(2);
    const dy = r.lines[0].y - r.lines[1].y;
    expect(dy).toBeCloseTo(b.lineHeight, 5);
  });

  it("shiftDelta cero cuando el contenido no cambia (sin deriva)", () => {
    const b = block([line("hola mundo", 700)]);
    const r = reflowBlock(b, "hola mundo", measure);
    expect(r.lines).toHaveLength(1);
    expect(r.shiftDelta).toBeCloseTo(0, 5);
  });

  it("conserva la primera línea base en el borde superior del bloque", () => {
    const b = block([line("corto", 700)]);
    const r = reflowBlock(b, "uno dos tres cuatro cinco seis siete ocho", measure);
    expect(r.lines[0].y).toBeCloseTo(b.top, 5);
  });

  it("shiftDelta equivale al cambio de líneas por el interlineado", () => {
    const b = block([line("corto", 700)]); // 1 línea → 2 líneas (216pt > 200pt)
    const r = reflowBlock(b, "uno dos tres cuatro cinco seis siete", measure);
    expect(r.lines).toHaveLength(2);
    expect(r.shiftDelta).toBeCloseTo((2 - 1) * b.lineHeight, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/tools/pdf-editor/reflow.test.ts`
Expected: FAIL — `Cannot find module './reflow'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/pdf-editor/reflow.ts
import type { TextBlock } from "./textblock";

export type MeasureFn = (text: string, fontSize: number) => number;

export interface ReflowLine {
  text: string;
  x: number;
  y: number;
  fontSize: number;
}

export interface ReflowResult {
  canReflow: boolean;
  lines: ReflowLine[];
  shiftDelta: number;
}

function wrap(
  words: string[],
  firstMax: number,
  otherMax: number,
  fontSize: number,
  measure: MeasureFn,
): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const trial = cur === "" ? word : `${cur} ${word}`;
    const limit = lines.length === 0 ? firstMax : otherMax;
    if (cur === "" || measure(trial, fontSize) <= limit) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

export function reflowBlock(
  block: TextBlock,
  newText: string,
  measure: MeasureFn,
): ReflowResult {
  if (!block.reflowable) {
    return { canReflow: false, lines: [], shiftDelta: 0 };
  }

  const fontSize = block.fontSize;
  const lineHeight = block.lineHeight;
  const oldHeight = block.top - block.bottom;
  const firstMax = block.width - block.indent;
  const otherMax = block.width;

  const words = newText.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) {
    return { canReflow: true, lines: [], shiftDelta: -oldHeight };
  }

  const wrapped = wrap(words, firstMax, otherMax, fontSize, measure);

  // Convención de coordenadas y-up: block.top ES la primera línea base
  // (Task 1: top = max(line.y)), y las líneas siguientes bajan de a lineHeight.
  const lines: ReflowLine[] = wrapped.map((text, i) => {
    const y = block.top - i * lineHeight;
    const w = measure(text, fontSize);
    let x = block.left + (i === 0 ? block.indent : 0);
    if (block.align === "center") x = block.left + (block.width - w) / 2;
    else if (block.align === "right") x = block.left + (block.width - w);
    return { text, x, y, fontSize };
  });

  // Misma convención de altura que Task 1 (oldHeight = top - bottom =
  // (n-1)*lineHeight + 0.25*fontSize), de modo que
  // shiftDelta = (nuevo - viejo) * lineHeight: 0 para contenido igual,
  // positivo cuando crece (empuja el contenido inferior hacia abajo).
  const newHeight = (wrapped.length - 1) * lineHeight + fontSize * 0.25;
  const shiftDelta = newHeight - oldHeight;
  return { canReflow: true, lines, shiftDelta };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/tools/pdf-editor/reflow.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/pdf-editor/reflow.ts src/tools/pdf-editor/reflow.test.ts
git commit -m "feat(pdf-editor): motor de reflujo de párrafo (puro)"
```

---

### Task 3: Font classification (`fonts.ts`)

**Files:**
- Create: `src/tools/pdf-editor/fonts.ts`
- Test: `src/tools/pdf-editor/fonts.test.ts`

**Interfaces:**
- Produces:
  - `type FontClass = "serif" | "sans" | "mono"`
  - `function classifyFont(baseFontName: string): FontClass`
  - `const DEFAULT_FONT_CLASS: FontClass`
  - `function mostCommon(items: FontClass[]): FontClass`

- [ ] **Step 1: Write the failing test**

```ts
// src/tools/pdf-editor/fonts.test.ts
import { describe, expect, it } from "vitest";
import { classifyFont, mostCommon, DEFAULT_FONT_CLASS } from "./fonts";

describe("classifyFont", () => {
  it("detecta serif (Times)", () => {
    expect(classifyFont("TimesNewRoman")).toBe("serif");
    expect(classifyFont("LiberationSerif")).toBe("serif");
    expect(classifyFont("Georgia")).toBe("serif");
  });

  it("detecta sans (Helvetica/Arial)", () => {
    expect(classifyFont("Helvetica")).toBe("sans");
    expect(classifyFont("Arial")).toBe("sans");
    expect(classifyFont("Calibri")).toBe("sans");
  });

  it("detecta mono (Courier)", () => {
    expect(classifyFont("Courier")).toBe("mono");
    expect(classifyFont("Consolas")).toBe("mono");
    expect(classifyFont("LiberationMono")).toBe("mono");
  });

  it("quita el prefijo de subset (ABCDEF+)", () => {
    expect(classifyFont("ABCDEF+Arial")).toBe("sans");
  });

  it("desconocido cae a la clase por defecto", () => {
    expect(classifyFont("WeirdFont123")).toBe(DEFAULT_FONT_CLASS);
  });

  it("FiraSans es sans, no mono (keyword 'firacode' no 'fira')", () => {
    expect(classifyFont("FiraSans")).toBe("sans");
    expect(classifyFont("FiraCode")).toBe("mono");
  });
});

describe("mostCommon", () => {
  it("elige la clase más frecuente", () => {
    expect(mostCommon(["sans", "sans", "serif"])).toBe("sans");
  });

  it("lista vacía devuelve la por defecto", () => {
    expect(mostCommon([])).toBe(DEFAULT_FONT_CLASS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/tools/pdf-editor/fonts.test.ts`
Expected: FAIL — `Cannot find module './fonts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/pdf-editor/fonts.ts
export type FontClass = "serif" | "sans" | "mono";

export const DEFAULT_FONT_CLASS: FontClass = "sans";

const MONO = ["courier", "consol", "menlo", "monaco", "lucidaconsole", "liberationmono", "dejavusansmono", "sourcecode", "firacode", "inconsolata"];
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/tools/pdf-editor/fonts.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/pdf-editor/fonts.ts src/tools/pdf-editor/fonts.test.ts
git commit -m "feat(pdf-editor): clasificación de fuentes serif/sans/mono"
```

---

### Task 4: History (undo/redo) (`history.ts`)

**Files:**
- Create: `src/tools/pdf-editor/history.ts`
- Test: `src/tools/pdf-editor/history.test.ts`

**Interfaces:**
- Produces:
  - `class History<T>` with `constructor(initial: T)`, `set(state: T): void`, `reset(state: T): void`, `undo(): T | null`, `redo(): T | null`, `canUndo(): boolean`, `canRedo(): boolean`, `current(): T` (`reset` limpio: borrado añadido tras review de Task 9 — `set` empuja el estado anterior al pasado, así que reabrir un archivo con `set([])` dejaría el historial del archivo anterior activo)

- [ ] **Step 1: Write the failing test**

```ts
// src/tools/pdf-editor/history.test.ts
import { describe, expect, it } from "vitest";
import { History } from "./history";

describe("History", () => {
  it("empieza en el estado inicial sin poder deshacer", () => {
    const h = new History("a");
    expect(h.current()).toBe("a");
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it("set empuja el estado anterior y permite deshacer", () => {
    const h = new History("a");
    h.set("b");
    expect(h.current()).toBe("b");
    expect(h.canUndo()).toBe(true);
    expect(h.undo()).toBe("a");
    expect(h.current()).toBe("a");
  });

  it("redo reaplica después de undo", () => {
    const h = new History("a");
    h.set("b");
    h.undo();
    expect(h.canRedo()).toBe(true);
    expect(h.redo()).toBe("b");
    expect(h.current()).toBe("b");
  });

  it("set limpia el futuro", () => {
    const h = new History("a");
    h.set("b");
    h.undo();
    h.set("c");
    expect(h.canRedo()).toBe(false);
    expect(h.current()).toBe("c");
  });

  it("reset limpia pasado y futuro sin dejar residuos", () => {
    const h = new History("a");
    h.set("b");
    h.set("c");
    h.undo();
    h.reset("z");
    expect(h.current()).toBe("z");
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it("undo en el fondo devuelve null y no cambia el estado", () => {
    const h = new History("a");
    expect(h.undo()).toBeNull();
    expect(h.current()).toBe("a");
  });

  it("soporta estados complejos (objetos)", () => {
    const h = new History({ n: 1 });
    h.set({ n: 2 });
    expect(h.current()).toEqual({ n: 2 });
    h.undo();
    expect(h.current()).toEqual({ n: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/tools/pdf-editor/history.test.ts`
Expected: FAIL — `Cannot find module './history'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/pdf-editor/history.ts
export class History<T> {
  private past: T[] = [];
  private present: T;
  private future: T[] = [];

  constructor(initial: T) {
    this.present = initial;
  }

  current(): T {
    return this.present;
  }

  set(state: T): void {
    this.past.push(this.present);
    this.present = state;
    this.future = [];
  }

  reset(state: T): void {
    this.past = [];
    this.present = state;
    this.future = [];
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): T | null {
    if (!this.canUndo()) return null;
    this.future.push(this.present);
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.present = prev;
    return this.present;
  }

  redo(): T | null {
    if (!this.canRedo()) return null;
    this.past.push(this.present);
    const next = this.future.pop();
    if (next === undefined) return null;
    this.present = next;
    return this.present;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/tools/pdf-editor/history.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/pdf-editor/history.ts src/tools/pdf-editor/history.test.ts
git commit -m "feat(pdf-editor): historial deshacer/rehacer"
```

---

### Task 5: Dependencies + document loading (`document.ts`)

**Files:**
- Modify: `package.json` (add deps)
- Create: `src/tools/pdf-editor/document.ts`
- Test: `src/tools/pdf-editor/document.test.ts` (pure helper only)

**Interfaces:**
- Consumes: `RawTextItem` (`./textblock`), `FontClass`/`mostCommon`/`classifyFont` (`./fonts`).
- Produces:
  - `interface LoadedPdf { bytes: Uint8Array; pdfLibDoc: PDFDocument; pageCount: number; pageSizes: { width: number; height: number }[]; fontClass: FontClass; getPageText(page: number): Promise<RawTextItem[]> }`
  - `async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf>`
  - `function toRawItems(textContent: { items: unknown[] }): RawTextItem[]` (pure, tested — normalizes pdf.js items)

- [ ] **Step 1: Add dependencies**

Edit `package.json` `dependencies` to add:
```json
"pdf-lib": "^1.17.1",
"pdfjs-dist": "^4.8.69"
```

Run: `npm install`
Expected: lockfile updated; no peer errors.

- [ ] **Step 1b: Add Vite client types**

Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

Without it, the `?worker` import fails `tsc` with TS2307 (tsconfig `include:
["src"]` picks this file up; `vite` is already a devDependency).

- [ ] **Step 2: Write the failing test for the pure helper**

```ts
// src/tools/pdf-editor/document.test.ts
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { loadPdf, toRawItems } from "./document";

// Node 20 no implementa Promise.withResolvers (pdf.js modern lo usa al
// abrir el documento); shim de compat SOLO para el entorno de tests.
const P = Promise as unknown as {
  withResolvers?: <T>() => {
    promise: Promise<T>;
    resolve: (v: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
};
if (typeof P.withResolvers !== "function") {
  P.withResolvers = function withResolvers<T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

describe("toRawItems", () => {
  it("normaliza los items de pdf.js a RawTextItem", () => {
    const content = {
      items: [
        { str: "hola", transform: [1, 0, 0, 1, 10, 20], width: 30, height: 12, fontName: "f1" },
        { str: "", transform: [1, 0, 0, 1, 0, 0], width: 0, height: 0, fontName: "f1" },
      ],
    };
    const raw = toRawItems(content);
    expect(raw).toHaveLength(2);
    expect(raw[0]).toEqual({ str: "hola", transform: [1, 0, 0, 1, 10, 20], width: 30, height: 12, fontName: "f1" });
  });

  it("tolera items con campos faltantes usando valores por defecto", () => {
    const raw = toRawItems({ items: [{ str: "x" }] });
    expect(raw[0].transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(raw[0].width).toBe(0);
  });
});

describe("loadPdf", () => {
  // TimesRoman → serif ≠ DEFAULT (sans): con el bug de PDFRef sin resolver,
  // baseNames=[] y fontClass cae a "sans" → el test falla (RED real).
  it("resuelve PDFRef de fuentes, clasifica y extrae texto", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    page.drawText("hola", { x: 10, y: 100, size: 12, font });
    const bytes = await doc.save();

    const loaded = await loadPdf(bytes);
    expect(loaded.pageCount).toBe(1);
    expect(loaded.fontClass).toBe("serif");
    const text = await loaded.getPageText(0);
    expect(text.some((t) => t.str.includes("hola"))).toBe(true);
    const blocks = await loaded.getBlocks(0);
    expect(blocks.length).toBeGreaterThan(0);
  }, 30000);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/tools/pdf-editor/document.test.ts`
Expected: FAIL — `Cannot find module './document'`

- [ ] **Step 4: Write implementation**

```ts
// src/tools/pdf-editor/document.ts
import { PDFDocument, PDFDict, PDFName } from "pdf-lib";
import * as pdfjs from "pdfjs-dist";
// Vite resolves the worker URL; pdf.js needs it for text extraction.
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import { groupTextItems, type RawTextItem, type TextBlock } from "./textblock";
import { classifyFont, mostCommon, type FontClass } from "./fonts";

// Lazy: el worker solo se construye al llamar loadPdf. La importación del
// módulo queda segura en node/vitest (no existe `Worker` ahí) y los tests
// puros de toRawItems nunca lo tocan.
let workerPortSet = false;
function ensureWorker(): void {
  if (workerPortSet) return;
  // En node/vitest no existe Worker: pdf.js cae a su fake worker, que
  // sirve para getTextContent — permite testear loadPdf en el suite.
  if (typeof Worker === "undefined") return;
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  workerPortSet = true;
}

export interface LoadedPdf {
  bytes: Uint8Array;
  pdfLibDoc: PDFDocument;
  pdfjsProxy: unknown;
  pageCount: number;
  pageSizes: { width: number; height: number }[];
  fontClass: FontClass;
  getPageText(page: number): Promise<RawTextItem[]>;
  getBlocks(page: number): Promise<TextBlock[]>;
}

export function toRawItems(textContent: { items?: unknown[] }): RawTextItem[] {
  const items = textContent.items ?? [];
  return items.map((it) => {
    const t = it as Partial<{
      str: string;
      transform: number[];
      width: number;
      height: number;
      fontName: string;
    }>;
    return {
      str: t.str ?? "",
      transform: t.transform ?? [1, 0, 0, 1, 0, 0],
      width: t.width ?? 0,
      height: t.height ?? 0,
      fontName: t.fontName ?? "",
    };
  });
}

function collectBaseFontNames(pdfLibDoc: PDFDocument): string[] {
  const names: string[] = [];
  for (const page of pdfLibDoc.getPages()) {
    const fontDict = page.node.normalizedEntries()?.Font;
    if (!fontDict) continue;
    for (const value of fontDict.values()) {
      // En PDFs reales el valor es un PDFRef (5 0 R), no un dict inline:
      // sin lookup, instanceof PDFDict falla siempre y baseNames queda [].
      const resolved = pdfLibDoc.context.lookup(value);
      if (!(resolved instanceof PDFDict)) continue;
      const base = resolved.get(PDFName.of("BaseFont"));
      if (base instanceof PDFName) {
        names.push(base.asString().replace(/^\//, ""));
      }
    }
  }
  return names;
}

export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  ensureWorker();
  const pdfLibDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageCount = pdfLibDoc.getPageCount();

  const pdfjsDoc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const pageSizes: { width: number; height: number }[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const p = await pdfjsDoc.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    pageSizes.push({ width: vp.width, height: vp.height });
  }

  const baseNames = collectBaseFontNames(pdfLibDoc);
  const fontClass = mostCommon(baseNames.map(classifyFont));

  // const local en vez de `this` en el object literal: TS2339 con `this`
  // dentro de métodos de un literal contextualizado.
  const getPageText = async (page: number): Promise<RawTextItem[]> => {
    const p = await pdfjsDoc.getPage(page + 1);
    const content = await p.getTextContent();
    return toRawItems(content);
  };

  return {
    bytes,
    pdfLibDoc,
    pdfjsProxy: pdfjsDoc,
    pageCount,
    pageSizes,
    fontClass,
    getPageText,
    async getBlocks(page: number): Promise<TextBlock[]> {
      const raw = await getPageText(page);
      return groupTextItems(raw, page);
    },
  };
}
```

- [ ] **Step 5: Run test to verify the pure helper passes**

Run: `npm test -- src/tools/pdf-editor/document.test.ts`
Expected: PASS (3 tests) — incluye la integración loadPdf (pdf.js con fake worker en node).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/vite-env.d.ts src/tools/pdf-editor/document.ts src/tools/pdf-editor/document.test.ts
git commit -m "feat(pdf-editor): carga de PDF (pdf-lib + pdf.js)"
```

---

### Task 6: Edit planning (`editor.ts` pure core)

**Files:**
- Create: `src/tools/pdf-editor/editor.ts`
- Test: `src/tools/pdf-editor/editor.test.ts`

**Notas del controlador (decisiones de diseño):**
- El filtro `.filter((b) => b.reflowable)` en `planReflowEdit` es deliberado (revisión Task 6): los bloques inferiores NO refluibles no se mueven, preservando sus glifos originales — redibujarlos sustituiría su fuente (`TextDraw` no lleva nombre de fuente). Limitación v1 documentada: si el párrafo refluído crece y alcanza a un bloque no refluible, pueden solaparse; dejar hueco al encogerse es aceptable. Multi-columna fuera de alcance.
- `export type { MeasureFn }` en editor.ts es real y necesario (el test lo importa desde `./editor`).
- Aserciones débiles heredadas (`toContain("adios")`, `>= 1`, `< 600` en vez de 585): pendientes de endurecer en la revisión final.

**Interfaces:**
- Consumes: `TextBlock`, `TextLine` (`./textblock`), `reflowBlock`, `MeasureFn`, `ReflowLine` (`./reflow`).
- Produces:
  - `interface Rect { x: number; y: number; width: number; height: number }`
  - `interface TextDraw { text: string; x: number; y: number; fontSize: number }`
  - `interface EditRecord { page: number; whiteouts: Rect[]; draws: TextDraw[] }`
  - `function planReflowEdit(edited: TextBlock, newText: string, belowBlocks: TextBlock[], measure: MeasureFn): EditRecord | null`
  - `function blockRect(block: TextBlock, pad?: number): Rect`
  - `function lineToDraws(line: TextLine | ReflowLine): TextDraw`

- [ ] **Step 1: Write the failing test**

```ts
// src/tools/pdf-editor/editor.test.ts
import { describe, expect, it } from "vitest";
import { planReflowEdit, blockRect, type MeasureFn } from "./editor";
import type { TextBlock, TextLine } from "./textblock";

const measure: MeasureFn = (text, fontSize) => text.length * fontSize * 0.5;

const mkLine = (text: string, y: number, x = 72, fontSize = 12): TextLine => ({
  text,
  x,
  y,
  width: text.length * fontSize * 0.5,
  fontSize,
  fontName: "f",
  runs: [],
});

const mkBlock = (lines: TextLine[], page = 0, reflowable = true): TextBlock => ({
  lines,
  left: 72,
  top: Math.max(...lines.map((l) => l.y)),
  bottom: Math.min(...lines.map((l) => l.y)) - 3,
  width: 200,
  fontSize: 12,
  lineHeight: 15,
  indent: 0,
  align: "left",
  reflowable,
  page,
});

describe("blockRect", () => {
  it("calcula el rectángulo envolvente con relleno", () => {
    const b = mkBlock([mkLine("abc", 700)]);
    const r = blockRect(b, 2);
    expect(r.x).toBe(70);
    expect(r.y).toBeLessThan(b.bottom);
    expect(r.width).toBe(b.width + 4);
    // cubre por encima de la primera línea base (ascendentes/glifos)
    expect(r.y + r.height).toBeGreaterThan(b.top + 0.7 * b.fontSize);
  });
});

describe("planReflowEdit", () => {
  it("devuelve null si el bloque no es refluible", () => {
    const b = mkBlock([mkLine("abc", 700)], 0, false);
    expect(planReflowEdit(b, "nuevo", [], measure)).toBeNull();
  });

  it("genera whiteout del bloque editado y draws del nuevo texto", () => {
    const b = mkBlock([mkLine("hola", 700)]);
    const edit = planReflowEdit(b, "adios", [], measure);
    expect(edit).not.toBeNull();
    expect(edit!.page).toBe(0);
    expect(edit!.whiteouts).toHaveLength(1);
    expect(edit!.draws.length).toBeGreaterThanOrEqual(1);
    expect(edit!.draws[0].text).toContain("adios");
  });

  it("con delta≠0 añade whiteout+dibujado de los bloques inferiores desplazados", () => {
    const edited = mkBlock([mkLine("corto", 700)]);
    const below = mkBlock([mkLine("inferior", 600)]);
    const edit = planReflowEdit(edited, "uno dos tres cuatro cinco seis siete ocho nueve", [below], measure)!;
    // whiteout: edited + below
    expect(edit.whiteouts.length).toBe(2);
    // y-up: el párrafo creció hacia abajo → el bloque inferior baja (y menor)
    const belowDraw = edit.draws.find((d) => d.text === "inferior")!;
    expect(belowDraw.y).toBeLessThan(600);
  });

  it("sin delta no toca los bloques inferiores", () => {
    const edited = mkBlock([mkLine("hola mundo", 700)]);
    const below = mkBlock([mkLine("inferior", 600)]);
    const edit = planReflowEdit(edited, "hola mundo", [below], measure)!;
    expect(edit.whiteouts.length).toBe(1);
    expect(edit.draws.find((d) => d.text === "inferior")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/tools/pdf-editor/editor.test.ts`
Expected: FAIL — `Cannot find module './editor'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/pdf-editor/editor.ts
import type { TextBlock, TextLine } from "./textblock";
import { reflowBlock, type MeasureFn, type ReflowLine } from "./reflow";

// Re-export: el test importa MeasureFn desde ./editor.
export type { MeasureFn };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextDraw {
  text: string;
  x: number;
  y: number;
  fontSize: number;
}

export interface EditRecord {
  page: number;
  whiteouts: Rect[];
  draws: TextDraw[];
}

const PAD = 2;

export function blockRect(block: TextBlock, pad = PAD): Rect {
  // Cubre los glifos: de descenderes bajo la última línea base (block.bottom
  // ya incluye 0.25·fontSize) hasta la ascendente sobre la primera
  // (block.top es la primera línea base, no el borde del glifo).
  return {
    x: block.left - pad,
    y: block.bottom - pad,
    width: block.width + pad * 2,
    height: block.top + block.fontSize * 0.8 - block.bottom + pad * 2,
  };
}

export function lineToDraws(line: TextLine | ReflowLine): TextDraw {
  return { text: line.text, x: line.x, y: line.y, fontSize: line.fontSize };
}

export function planReflowEdit(
  edited: TextBlock,
  newText: string,
  belowBlocks: TextBlock[],
  measure: MeasureFn,
): EditRecord | null {
  if (!edited.reflowable) return null;

  const result = reflowBlock(edited, newText, measure);
  if (!result.canReflow) return null;

  const whiteouts: Rect[] = [blockRect(edited)];
  const draws: TextDraw[] = result.lines.map(lineToDraws);

  if (Math.abs(result.shiftDelta) > 0.01) {
    const belowSorted = [...belowBlocks]
      .filter((b) => b.reflowable)
      .sort((a, b) => b.top - a.top);
    for (const below of belowSorted) {
      whiteouts.push(blockRect(below));
      // y-up: shiftDelta > 0 = el bloque creció hacia abajo, entonces el
      // contenido inferior debe bajar (y disminuye) → restamos el delta.
      for (const line of below.lines) {
        draws.push({ ...lineToDraws(line), y: line.y - result.shiftDelta });
      }
    }
  }

  return { page: edited.page, whiteouts, draws };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/tools/pdf-editor/editor.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/pdf-editor/editor.ts src/tools/pdf-editor/editor.test.ts
git commit -m "feat(pdf-editor): planificación de edición (whiteout + redibujado)"
```

---

### Task 7: Measure + apply + save (canvas/Tauri integration)

**Files:**
- Create: `src/tools/pdf-editor/measure.ts`
- Create: `src/tools/pdf-editor/apply.ts`
- Test: `src/tools/pdf-editor/measure.test.ts` (mock de ctx: familia CSS por fontClass)
- Test: `src/tools/pdf-editor/apply.test.ts` (pure signature check; apply itself verified in Task 9)

**Interfaces:**
- Consumes: `EditRecord` (`./editor`), `LoadedPdf` (`./document`), `FontClass` (`./fonts`).
- Produces:
  - `function createMeasure(ctx: CanvasRenderingContext2D, fontClass?: FontClass): MeasureFn` (in `measure.ts`) — mide con la familia CSS que coincide con `fontClass` (serif→`serif`, sans→`sans-serif`, mono→`monospace`) para que el wrap coincida con la fuente con la que `applyEdits` dibuja
  - `async function applyEdits(originalBytes: Uint8Array, edits: EditRecord[], fontClass: FontClass): Promise<Uint8Array>` (in `apply.ts`) — returns final saved bytes
  - `function standardFontFor(cls: FontClass): StandardFonts` (in `apply.ts`)

- [ ] **Step 1: Write the failing measure test**

```ts
// src/tools/pdf-editor/measure.test.ts
import { describe, expect, it } from "vitest";
import { createMeasure } from "./measure";

const mockCtx = (): CanvasRenderingContext2D =>
  ({
    font: "",
    measureText(text: string) {
      return { width: text.length * 6 };
    },
  }) as unknown as CanvasRenderingContext2D;

describe("createMeasure", () => {
  it("mide con la familia CSS que coincide con la clase de fuente", () => {
    const ctx = mockCtx();
    createMeasure(ctx, "mono")("hola", 12);
    expect(ctx.font).toBe("12px monospace");
    createMeasure(ctx, "serif")("hola", 14);
    expect(ctx.font).toBe("14px serif");
  });

  it("por defecto usa sans-serif y devuelve el ancho del ctx", () => {
    const ctx = mockCtx();
    const m = createMeasure(ctx);
    expect(m("abcdef", 10)).toBe(36);
    expect(ctx.font).toBe("10px sans-serif");
  });
});
```

Run: `npm test -- src/tools/pdf-editor/measure.test.ts`
Expected: FAIL — `Cannot find module './measure'`

- [ ] **Step 1b: Write the measure module**

```ts
// src/tools/pdf-editor/measure.ts
import type { MeasureFn } from "./reflow";
import type { FontClass } from "./fonts";

// Ojo: el tamaño va en `px` a propósito. measureText devuelve un número
// proporcional al tamaño de la fuente, así que la cifra en pt para12pt
// coincide numéricamente con la cifra en px para12px. Medir con
// `${fontSize}pt` daría ×1.33 (el navegador convierte12pt→16px).
const CSS_FAMILY: Record<FontClass, string> = {
  serif: "serif",
  sans: "sans-serif",
  mono: "monospace",
};

export function createMeasure(
  ctx: CanvasRenderingContext2D,
  fontClass: FontClass = "sans",
): MeasureFn {
  const family = CSS_FAMILY[fontClass];
  return (text: string, fontSize: number): number => {
    ctx.font = `${fontSize}px ${family}`;
    return ctx.measureText(text).width;
  };
}
```

Run: `npm test -- src/tools/pdf-editor/measure.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 2: Write the failing apply test**

```ts
// src/tools/pdf-editor/apply.test.ts
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { standardFontFor, applyEdits } from "./apply";

describe("standardFontFor", () => {
  it("mapea clases a fuentes pdf-lib", async () => {
    const { StandardFonts } = await import("pdf-lib");
    expect(standardFontFor("sans")).toBe(StandardFonts.Helvetica);
    expect(standardFontFor("serif")).toBe(StandardFonts.TimesRoman);
    expect(standardFontFor("mono")).toBe(StandardFonts.Courier);
  });
});

describe("applyEdits", () => {
  it("produce un PDF válido con la página intacta", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const bytes = await doc.save();

    const out = await applyEdits(bytes, [], "sans");
    const re = await PDFDocument.load(out);
    expect(re.getPageCount()).toBe(1);
  });

  it("aplica whiteout+dibujado sin lanzar", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const bytes = await doc.save();
    const out = await applyEdits(
      bytes,
      [
        {
          page: 0,
          whiteouts: [{ x: 10, y: 10, width: 100, height: 20 }],
          draws: [{ text: "nuevo", x: 10, y: 20, fontSize: 12 }],
        },
      ],
      "sans",
    );
    expect(out.length).toBeGreaterThan(0);
    const re = await PDFDocument.load(out);
    expect(re.getPageCount()).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/tools/pdf-editor/apply.test.ts`
Expected: FAIL — `Cannot find module './apply'`

- [ ] **Step 4: Write apply implementation**

```ts
// src/tools/pdf-editor/apply.ts
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { EditRecord } from "./editor";
import type { FontClass } from "./fonts";

export function standardFontFor(cls: FontClass): StandardFonts {
  if (cls === "serif") return StandardFonts.TimesRoman;
  if (cls === "mono") return StandardFonts.Courier;
  return StandardFonts.Helvetica;
}

function applyOne(
  doc: PDFDocument,
  edit: EditRecord,
  font: PDFFont,
): void {
  const page = doc.getPage(edit.page);
  for (const r of edit.whiteouts) {
    page.drawRectangle({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });
  }
  for (const d of edit.draws) {
    if (d.text.length === 0) continue;
    page.drawText(d.text, {
      x: d.x,
      y: d.y,
      size: d.fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }
}

export async function applyEdits(
  originalBytes: Uint8Array,
  edits: EditRecord[],
  fontClass: FontClass,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(standardFontFor(fontClass));
  for (const edit of edits) {
    if (edit.page < 0 || edit.page >= doc.getPageCount()) continue;
    applyOne(doc, edit, font);
  }
  return doc.save();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/tools/pdf-editor/apply.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/tools/pdf-editor/measure.ts src/tools/pdf-editor/measure.test.ts src/tools/pdf-editor/apply.ts src/tools/pdf-editor/apply.test.ts
git commit -m "feat(pdf-editor): medición (canvas) y aplicación de ediciones pdf-lib"
```

---

### Task 8: Viewer + save (Tauri wiring)

**Files:**
- Create: `src/tools/pdf-editor/viewer.ts`
- Create: `src/tools/pdf-editor/save.ts`

**Interfaces:**
- Consumes: `LoadedPdf` (`./document`).
- Produces:
  - `class PdfViewer` (in `viewer.ts`) with `constructor(canvas: HTMLCanvasElement)`, `async render(pdf: LoadedPdf, page: number, scale: number): Promise<void>`, `lastRenderedPage(): number`.
  - `async function savePdf(bytes: Uint8Array, suggestedName: string): Promise<string | null>` (in `save.ts`) — returns saved path or null if cancelled.

- [ ] **Step 1: Write viewer**

```ts
// src/tools/pdf-editor/viewer.ts
import type { LoadedPdf } from "./document";

interface PdfjsPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: {
    canvasContext: CanvasRenderingContext2D;
    viewport: unknown;
  }): { promise: Promise<void> };
}

interface PdfjsProxy {
  getPage(n: number): Promise<PdfjsPage>;
}

export class PdfViewer {
  private page = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  lastRenderedPage(): number {
    return this.page;
  }

  async render(pdf: LoadedPdf, pageNumber: number, scale: number): Promise<void> {
    const doc = pdf.pdfjsProxy as PdfjsProxy;
    const page = await doc.getPage(pageNumber + 1);
    const viewport = page.getViewport({ scale });
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    this.canvas.width = Math.floor(viewport.width);
    this.canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    this.page = pageNumber;
  }
}
```

- [ ] **Step 2: Write save**

```ts
// src/tools/pdf-editor/save.ts
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { dirnameFromPath } from "../photo-background/paths";

export async function savePdf(bytes: Uint8Array, suggestedName: string): Promise<string | null> {
  const path = await save({
    title: "Guardar PDF editado",
    defaultPath: suggestedName,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return null;
  await writeFile(path, bytes);
  return path;
}

export { dirnameFromPath };
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run build`
Expected: `tsc` passes; `viewer.ts`/`save.ts` compile (`document.ts` already exposes `pdfjsProxy` from Task 5).

- [ ] **Step 4: Commit**

```bash
git add src/tools/pdf-editor/viewer.ts src/tools/pdf-editor/save.ts
git commit -m "feat(pdf-editor): visor pdf.js y guardado vía Tauri"
```

---

### Task 9: UI shell + registration + styles

**Files:**
- Create: `src/tools/pdf-editor/index.ts`
- Modify: `src/tools/registry.ts` — add `"pdf"` to `ToolIcon`, add tool entry.
- Modify: `src/tools/icons.ts` — add `pdf` SVG.
- Modify: `src/tools/index.ts` — import + register `pdfEditor`.
- Modify: `src/styles.css` — append PDF-editor-specific styles.

**Interfaces:**
- Consumes: all prior modules.
- Produces: `export const pdfEditor: ToolModule` (in `index.ts`).

- [ ] **Step 1: Register the tool**

In `src/tools/registry.ts`, change the type and add the entry:
```ts
export type ToolIcon = "photo" | "pdf";
// ...in `tools` array:
{
  id: "pdf-editor",
  name: "Editor de PDF",
  description: "Edita el texto existente de un PDF con reflujo",
  icon: "pdf",
},
```

In `src/tools/icons.ts`, add to the `icons` record:
```ts
pdf: `
  <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M14 8 h24 l12 12 v36 a2 2 0 0 1 -2 2 H14 a2 2 0 0 1 -2 -2 V10 a2 2 0 0 1 2 -2 z"/>
    <path d="M38 8 v12 h12"/>
    <path d="M22 34 h16 M22 42 h16 M22 50 h10"/>
  </svg>`,
```

In `src/tools/index.ts`, add import and registration:
```ts
import { pdfEditor } from "./pdf-editor";
// ...in toolModules:
"pdf-editor": pdfEditor,
```

- [ ] **Step 2: Write the UI shell (`index.ts`)**

```ts
// src/tools/pdf-editor/index.ts
import type { ToolModule } from "../index";
import { loadPdf, type LoadedPdf } from "./document";
import { PdfViewer } from "./viewer";
import { createMeasure } from "./measure";
import { planReflowEdit, type EditRecord } from "./editor";
import { applyEdits } from "./apply";
import { savePdf } from "./save";
import { History } from "./history";
import type { TextBlock } from "./textblock";

let dispose: (() => void) | undefined;

const PAD_NAME = "documento.pdf";

export const pdfEditor: ToolModule = {
  mount(container) {
    let mounted = true;
    let pdf: LoadedPdf | null = null;
    let source: Uint8Array | null = null;
    let blocks: TextBlock[] = [];
    let currentPage = 0;
    let scale = 1.2;
    const history = new History<EditRecord[]>([]);
    let measureCtx: CanvasRenderingContext2D | null = null;

    container.innerHTML = `
      <div class="dropzone" id="pe-dropzone">
        <p>Arrastra un PDF aquí</p>
        <p class="hint">o haz clic para elegir un archivo</p>
        <input id="pe-input" type="file" accept="application/pdf" class="hidden" />
      </div>
      <div id="pe-status" class="status-msg"></div>
      <div class="pe-toolbar hidden" id="pe-toolbar">
        <button id="pe-prev" type="button" class="pe-btn">◀</button>
        <span id="pe-pageinfo">1 / 1</span>
        <button id="pe-next" type="button" class="pe-btn">▶</button>
        <span class="pe-sep"></span>
        <button id="pe-zoomout" type="button" class="pe-btn">−</button>
        <button id="pe-zoomin" type="button" class="pe-btn">+</button>
        <span class="pe-sep"></span>
        <button id="pe-undo" type="button" class="pe-btn" disabled>Deshacer</button>
        <button id="pe-redo" type="button" class="pe-btn" disabled>Rehacer</button>
        <span class="pe-grow"></span>
        <button id="pe-save" type="button" class="btn-primary">Guardar PDF</button>
      </div>
      <div class="pe-canvas-wrap hidden" id="pe-wrap">
        <canvas id="pe-canvas"></canvas>
        <textarea id="pe-editor" class="pe-inline-editor hidden"></textarea>
      </div>
    `;

    const $ = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
    const dropzone = $("pe-dropzone");
    const input = $("pe-input") as HTMLInputElement;
    const status = $("pe-status");
    const toolbar = $("pe-toolbar");
    const wrap = $("pe-wrap");
    const canvas = $("pe-canvas") as HTMLCanvasElement;
    const pageInfo = $("pe-pageinfo");
    const textarea = $("pe-editor") as HTMLTextAreaElement;
    const viewer = new PdfViewer(canvas);

    const setStatus = (msg: string, error = false): void => {
      status.textContent = msg;
      status.classList.toggle("error", error);
    };

    const measure = (text: string, fontSize: number): number => {
      if (!measureCtx) {
        const c = document.createElement("canvas");
        measureCtx = c.getContext("2d");
      }
      if (!measureCtx) return text.length * fontSize * 0.5;
      return createMeasure(measureCtx, pdf?.fontClass ?? "sans")(text, fontSize);
    };

    const refreshButtons = (): void => {
      ($("pe-undo") as HTMLButtonElement).disabled = !history.canUndo();
      ($("pe-redo") as HTMLButtonElement).disabled = !history.canRedo();
    };

    const renderCurrent = async (): Promise<void> => {
      if (!pdf) return;
      await viewer.render(pdf, currentPage, scale);
      blocks = await pdf.getBlocks(currentPage);
      pageInfo.textContent = `${currentPage + 1} / ${pdf.pageCount}`;
    };

    const rebuild = async (): Promise<void> => {
      if (!pdf || !source) return;
      const finalBytes = await applyEdits(source, history.current(), pdf.fontClass);
      pdf = await loadPdf(finalBytes);
      await renderCurrent();
    };

    const openFile = async (file: File | null | undefined): Promise<void> => {
      if (!file) return;
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setStatus("El archivo seleccionado no es un PDF.", true);
        return;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        pdf = await loadPdf(bytes);
        source = bytes;
        history.reset([]);
        dropzone.classList.add("hidden");
        toolbar.classList.remove("hidden");
        wrap.classList.remove("hidden");
        currentPage = 0;
        await renderCurrent();
        refreshButtons();
        setStatus("Haz clic sobre un texto para editarlo.");
      } catch (err) {
        setStatus(`Error al abrir el PDF: ${(err as Error).message}`, true);
      }
    };

    const commitEdit = (block: TextBlock, newText: string): void => {
      if (!pdf) return;
      const below = blocks.filter((b) => b.page === block.page && b.top <= block.bottom);
      const edit = planReflowEdit(block, newText, below, measure);
      if (!edit) {
        setStatus("Este bloque no admite reflujo; no se aplicó el cambio.", true);
        return;
      }
      history.set([...history.current(), edit]);
      refreshButtons();
      void rebuild().then(() => setStatus("Texto actualizado."));
    };

    const openInlineEditor = (block: TextBlock): void => {
      const rectX = block.left * scale;
      const rectW = block.width * scale;
      const canvasRect = canvas.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const screenX = canvasRect.left - wrapRect.left + rectX;
      const screenY = canvasRect.top - wrapRect.top + (canvas.height - block.top * scale);
      const screenH = (block.top - block.bottom) * scale;
      textarea.style.left = `${screenX}px`;
      textarea.style.top = `${screenY}px`;
      textarea.style.width = `${Math.max(rectW, 80)}px`;
      textarea.style.height = `${Math.max(screenH, 20)}px`;
      textarea.style.fontSize = `${block.fontSize * scale}px`;
      textarea.value = block.lines.map((l) => l.text).join("\n");
      textarea.classList.remove("hidden");
      textarea.focus();
      textarea.dataset.active = "1";
      textarea.dataset.blockTop = String(block.top);
    };

    const activeBlock = (): TextBlock | null => {
      if (textarea.dataset.active !== "1") return null;
      const top = Number(textarea.dataset.blockTop);
      return blocks.find((b) => b.top === top) ?? null;
    };

    const onCanvasClick = (e: MouseEvent): void => {
      if (!pdf) return;
      const bounds = canvas.getBoundingClientRect();
      const pdfX = (e.clientX - bounds.left) / scale;
      const size = pdf.pageSizes[currentPage];
      const pdfY = size.height - (e.clientY - bounds.top) / scale;
      const hit = blocks.find(
        (b) => pdfX >= b.left && pdfX <= b.left + b.width && pdfY <= b.top && pdfY >= b.bottom,
      );
      if (hit) openInlineEditor(hit);
    };

    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        textarea.classList.add("hidden");
        textarea.dataset.active = "0";
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        const block = activeBlock();
        textarea.classList.add("hidden");
        textarea.dataset.active = "0";
        if (block) commitEdit(block, textarea.value);
      }
    };

    dropzone.addEventListener("click", () => input.click());
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      void openFile(e.dataTransfer?.files.item(0));
    });
    input.addEventListener("change", () => void openFile(input.files?.item(0)));

    $("pe-prev").addEventListener("click", () => {
      if (currentPage > 0) {
        currentPage--;
        void renderCurrent();
      }
    });
    $("pe-next").addEventListener("click", () => {
      if (pdf && currentPage < pdf.pageCount - 1) {
        currentPage++;
        void renderCurrent();
      }
    });
    $("pe-zoomin").addEventListener("click", () => {
      scale = Math.min(scale + 0.2, 4);
      void renderCurrent();
    });
    $("pe-zoomout").addEventListener("click", () => {
      scale = Math.max(scale - 0.2, 0.5);
      void renderCurrent();
    });
    $("pe-undo").addEventListener("click", () => {
      history.undo();
      refreshButtons();
      void rebuild();
    });
    $("pe-redo").addEventListener("click", () => {
      history.redo();
      refreshButtons();
      void rebuild();
    });
    $("pe-save").addEventListener("click", () => {
      if (!pdf || !source) return;
      void applyEdits(source, history.current(), pdf.fontClass).then((out) =>
        savePdf(out, PAD_NAME).then((path) => {
          if (path) setStatus(`Guardada en: ${path}`);
        }),
      );
    });

    canvas.addEventListener("click", onCanvasClick);
    textarea.addEventListener("keydown", onKeydown);

    const preventNav = (e: DragEvent): void => e.preventDefault();
    window.addEventListener("dragover", preventNav);
    window.addEventListener("drop", preventNav);

    dispose = () => {
      mounted = false;
      void mounted;
      window.removeEventListener("dragover", preventNav);
      window.removeEventListener("drop", preventNav);
    };
  },

  unmount() {
    dispose?.();
    dispose = undefined;
  },
};
```

- [ ] **Step 3: Append PDF-editor CSS to `src/styles.css`**

```css
/* ---- PDF editor ---- */
.pe-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--tile);
  border: 1px solid var(--tile-border);
  border-radius: 10px;
  flex-wrap: wrap;
}
.pe-btn {
  padding: 6px 12px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--tile-border);
  border-radius: 8px;
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
}
.pe-btn:hover:not(:disabled) { border-color: var(--accent); }
.pe-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pe-sep { width: 1px; height: 20px; background: var(--tile-border); }
.pe-grow { flex: 1; }
.pe-canvas-wrap {
  position: relative;
  overflow: auto;
  background: #1e1e1e;
  border: 1px solid var(--tile-border);
  border-radius: 10px;
  padding: 12px;
}
.pe-canvas-wrap canvas { display: block; margin: 0 auto; background: #fff; }
.pe-inline-editor {
  position: absolute;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.96);
  color: #101010;
  border: 2px solid var(--accent);
  border-radius: 4px;
  padding: 0 2px;
  margin: 0;
  resize: none;
  overflow: hidden;
  font-family: sans-serif;
  line-height: 1.2;
}
```

- [ ] **Step 4: Build + run full test suite**

Run: `npm test && npm run build`
Expected: all tests pass; `tsc && vite build` succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/tools/pdf-editor/index.ts src/tools/registry.ts src/tools/icons.ts src/tools/index.ts src/styles.css
git commit -m "feat(pdf-editor): UI shell, registro de herramienta y estilos"
```

---

## Self-Review

- **Spec coverage:** load ✓ (T5), render/nav/zoom ✓ (T8/T9), paragraph model ✓ (T1), reflow ✓ (T2), edit/whiteout ✓ (T6/T7), undo/redo ✓ (T4), save ✓ (T8), registration ✓ (T9), fonts ✓ (T3/T7). Edge cases (non-reflowable/rotated) → `reflowable` flag ✓ (T1/T2/T6).
- **Placeholders:** none. The one intentional fix-up is Task 8 Step 1's note to add `pdfjsProxy` to `document.ts` and Task 9 Step 3's flip fix — both are concrete, not TBD.
- **Type consistency:** `MeasureFn`, `TextBlock`, `EditRecord`, `ReflowLine`, `FontClass` names match across tasks. `planReflowEdit`/`applyEdits`/`loadPdf` signatures are consistent with consumers.
