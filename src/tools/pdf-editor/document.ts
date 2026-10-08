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
      if (!(value instanceof PDFDict)) continue;
      const base = value.get(PDFName.of("BaseFont"));
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
