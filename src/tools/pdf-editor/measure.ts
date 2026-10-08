// src/tools/pdf-editor/measure.ts
import type { MeasureFn } from "./reflow";

export function createMeasure(ctx: CanvasRenderingContext2D): MeasureFn {
  return (text: string, fontSize: number): number => {
    ctx.font = `${fontSize}px sans-serif`;
    return ctx.measureText(text).width;
  };
}
