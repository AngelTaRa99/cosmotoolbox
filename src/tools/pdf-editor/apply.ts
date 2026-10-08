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
