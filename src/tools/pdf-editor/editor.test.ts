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
