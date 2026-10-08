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
