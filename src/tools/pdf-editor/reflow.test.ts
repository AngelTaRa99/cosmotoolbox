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
