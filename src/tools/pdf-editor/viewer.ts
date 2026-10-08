// src/tools/pdf-editor/viewer.ts
import type { LoadedPdf } from "./document";

interface PdfjsPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: {
    canvasContext: CanvasRenderingContext2D;
    viewport: unknown;
  }): { promise: Promise<void> };
}

interface PdfjsProxy {
  getPage(n: number): Promise<PdfjsPage>;
}

export class PdfViewer {
  private page = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  lastRenderedPage(): number {
    return this.page;
  }

  async render(pdf: LoadedPdf, pageNumber: number, scale: number): Promise<void> {
    const doc = pdf.pdfjsProxy as PdfjsProxy;
    const page = await doc.getPage(pageNumber + 1);
    const viewport = page.getViewport({ scale });
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    this.canvas.width = Math.floor(viewport.width);
    this.canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    this.page = pageNumber;
  }
}
