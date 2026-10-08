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
