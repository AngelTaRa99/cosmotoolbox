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
