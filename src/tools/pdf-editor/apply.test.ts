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
