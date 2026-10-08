// src/tools/pdf-editor/document.test.ts
import { describe, expect, it } from "vitest";
import { toRawItems } from "./document";

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
