// src/tools/pdf-editor/index.ts
import type { ToolModule } from "../index";
import { loadPdf, type LoadedPdf } from "./document";
import { PdfViewer } from "./viewer";
import { createMeasure } from "./measure";
import { planReflowEdit, type EditRecord } from "./editor";
import { applyEdits } from "./apply";
import { savePdf } from "./save";
import { History } from "./history";
import type { TextBlock } from "./textblock";

let dispose: (() => void) | undefined;

const PAD_NAME = "documento.pdf";

export const pdfEditor: ToolModule = {
  mount(container) {
    let mounted = true;
    let pdf: LoadedPdf | null = null;
    let source: Uint8Array | null = null;
    let blocks: TextBlock[] = [];
    let currentPage = 0;
    let scale = 1.2;
    const history = new History<EditRecord[]>([]);
    let measureCtx: CanvasRenderingContext2D | null = null;

    container.innerHTML = `
      <div class="dropzone" id="pe-dropzone">
        <p>Arrastra un PDF aquí</p>
        <p class="hint">o haz clic para elegir un archivo</p>
        <input id="pe-input" type="file" accept="application/pdf" class="hidden" />
      </div>
      <div id="pe-status" class="status-msg"></div>
      <div class="pe-toolbar hidden" id="pe-toolbar">
        <button id="pe-prev" type="button" class="pe-btn">◀</button>
        <span id="pe-pageinfo">1 / 1</span>
        <button id="pe-next" type="button" class="pe-btn">▶</button>
        <span class="pe-sep"></span>
        <button id="pe-zoomout" type="button" class="pe-btn">−</button>
        <button id="pe-zoomin" type="button" class="pe-btn">+</button>
        <span class="pe-sep"></span>
        <button id="pe-undo" type="button" class="pe-btn" disabled>Deshacer</button>
        <button id="pe-redo" type="button" class="pe-btn" disabled>Rehacer</button>
        <span class="pe-grow"></span>
        <button id="pe-save" type="button" class="btn-primary">Guardar PDF</button>
      </div>
      <div class="pe-canvas-wrap hidden" id="pe-wrap">
        <canvas id="pe-canvas"></canvas>
        <textarea id="pe-editor" class="pe-inline-editor hidden"></textarea>
      </div>
    `;

    const $ = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
    const dropzone = $("pe-dropzone");
    const input = $("pe-input") as HTMLInputElement;
    const status = $("pe-status");
    const toolbar = $("pe-toolbar");
    const wrap = $("pe-wrap");
    const canvas = $("pe-canvas") as HTMLCanvasElement;
    const pageInfo = $("pe-pageinfo");
    const textarea = $("pe-editor") as HTMLTextAreaElement;
    const viewer = new PdfViewer(canvas);

    const setStatus = (msg: string, error = false): void => {
      status.textContent = msg;
      status.classList.toggle("error", error);
    };

    const measure = (text: string, fontSize: number): number => {
      if (!measureCtx) {
        const c = document.createElement("canvas");
        measureCtx = c.getContext("2d");
      }
      if (!measureCtx) return text.length * fontSize * 0.5;
      return createMeasure(measureCtx, pdf?.fontClass ?? "sans")(text, fontSize);
    };

    const refreshButtons = (): void => {
      ($("pe-undo") as HTMLButtonElement).disabled = !history.canUndo();
      ($("pe-redo") as HTMLButtonElement).disabled = !history.canRedo();
    };

    const renderCurrent = async (): Promise<void> => {
      if (!pdf) return;
      await viewer.render(pdf, currentPage, scale);
      blocks = await pdf.getBlocks(currentPage);
      pageInfo.textContent = `${currentPage + 1} / ${pdf.pageCount}`;
    };

    const rebuild = async (): Promise<void> => {
      if (!pdf || !source) return;
      const finalBytes = await applyEdits(source, history.current(), pdf.fontClass);
      pdf = await loadPdf(finalBytes);
      await renderCurrent();
    };

    const openFile = async (file: File | null | undefined): Promise<void> => {
      if (!file) return;
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setStatus("El archivo seleccionado no es un PDF.", true);
        return;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        pdf = await loadPdf(bytes);
        source = bytes;
        history.reset([]);
        dropzone.classList.add("hidden");
        toolbar.classList.remove("hidden");
        wrap.classList.remove("hidden");
        currentPage = 0;
        await renderCurrent();
        refreshButtons();
        setStatus("Haz clic sobre un texto para editarlo.");
      } catch (err) {
        setStatus(`Error al abrir el PDF: ${(err as Error).message}`, true);
      }
    };

    const commitEdit = (block: TextBlock, newText: string): void => {
      if (!pdf) return;
      const below = blocks.filter((b) => b.page === block.page && b.top <= block.bottom);
      const edit = planReflowEdit(block, newText, below, measure);
      if (!edit) {
        setStatus("Este bloque no admite reflujo; no se aplicó el cambio.", true);
        return;
      }
      history.set([...history.current(), edit]);
      refreshButtons();
      void rebuild().then(() => setStatus("Texto actualizado."));
    };

    const openInlineEditor = (block: TextBlock): void => {
      const rectX = block.left * scale;
      const rectW = block.width * scale;
      const canvasRect = canvas.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const screenX = canvasRect.left - wrapRect.left + rectX;
      const screenY = canvasRect.top - wrapRect.top + (canvas.height - block.top * scale);
      const screenH = (block.top - block.bottom) * scale;
      textarea.style.left = `${screenX}px`;
      textarea.style.top = `${screenY}px`;
      textarea.style.width = `${Math.max(rectW, 80)}px`;
      textarea.style.height = `${Math.max(screenH, 20)}px`;
      textarea.style.fontSize = `${block.fontSize * scale}px`;
      textarea.value = block.lines.map((l) => l.text).join("\n");
      textarea.classList.remove("hidden");
      textarea.focus();
      textarea.dataset.active = "1";
      textarea.dataset.blockTop = String(block.top);
    };

    const activeBlock = (): TextBlock | null => {
      if (textarea.dataset.active !== "1") return null;
      const top = Number(textarea.dataset.blockTop);
      return blocks.find((b) => b.top === top) ?? null;
    };

    const onCanvasClick = (e: MouseEvent): void => {
      if (!pdf) return;
      const bounds = canvas.getBoundingClientRect();
      const pdfX = (e.clientX - bounds.left) / scale;
      const size = pdf.pageSizes[currentPage];
      const pdfY = size.height - (e.clientY - bounds.top) / scale;
      const hit = blocks.find(
        (b) => pdfX >= b.left && pdfX <= b.left + b.width && pdfY <= b.top && pdfY >= b.bottom,
      );
      if (hit) openInlineEditor(hit);
    };

    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        textarea.classList.add("hidden");
        textarea.dataset.active = "0";
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        const block = activeBlock();
        textarea.classList.add("hidden");
        textarea.dataset.active = "0";
        if (block) commitEdit(block, textarea.value);
      }
    };

    dropzone.addEventListener("click", () => input.click());
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      void openFile(e.dataTransfer?.files.item(0));
    });
    input.addEventListener("change", () => void openFile(input.files?.item(0)));

    $("pe-prev").addEventListener("click", () => {
      if (currentPage > 0) {
        currentPage--;
        void renderCurrent();
      }
    });
    $("pe-next").addEventListener("click", () => {
      if (pdf && currentPage < pdf.pageCount - 1) {
        currentPage++;
        void renderCurrent();
      }
    });
    $("pe-zoomin").addEventListener("click", () => {
      scale = Math.min(scale + 0.2, 4);
      void renderCurrent();
    });
    $("pe-zoomout").addEventListener("click", () => {
      scale = Math.max(scale - 0.2, 0.5);
      void renderCurrent();
    });
    $("pe-undo").addEventListener("click", () => {
      history.undo();
      refreshButtons();
      void rebuild();
    });
    $("pe-redo").addEventListener("click", () => {
      history.redo();
      refreshButtons();
      void rebuild();
    });
    $("pe-save").addEventListener("click", () => {
      if (!pdf || !source) return;
      void applyEdits(source, history.current(), pdf.fontClass).then((out) =>
        savePdf(out, PAD_NAME).then((path) => {
          if (path) setStatus(`Guardada en: ${path}`);
        }),
      );
    });

    canvas.addEventListener("click", onCanvasClick);
    textarea.addEventListener("keydown", onKeydown);

    const preventNav = (e: DragEvent): void => e.preventDefault();
    window.addEventListener("dragover", preventNav);
    window.addEventListener("drop", preventNav);

    dispose = () => {
      mounted = false;
      void mounted;
      window.removeEventListener("dragover", preventNav);
      window.removeEventListener("drop", preventNav);
    };
  },

  unmount() {
    dispose?.();
    dispose = undefined;
  },
};
