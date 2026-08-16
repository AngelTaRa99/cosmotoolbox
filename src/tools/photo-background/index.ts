import { removeBackground, preload, type Config } from "@imgly/background-removal";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { ToolModule } from "../index";
import { SlotUrlManager } from "./urls";
import { progressInfo } from "./progress";
import { dirnameFromPath } from "./paths";

let dispose: (() => void) | undefined;

export const photoBackground: ToolModule = {
  mount(container) {
    const urls = new SlotUrlManager();
    let mounted = true;
    let inputFile: File | null = null;
    let resultBlob: Blob | null = null;
    let processing = false;
    let lastSaveDir = "";

    container.innerHTML = `
      <div class="dropzone" id="pz-dropzone">
        <p>Arrastra una imagen aquí</p>
        <p class="hint">o haz clic para elegir un archivo (JPG, PNG, WebP)</p>
        <input id="pz-input" type="file" accept="image/*" class="hidden" />
      </div>

      <div id="pz-status" class="status-msg"></div>

      <div id="pz-progress" class="progress-wrap hidden">
        <div class="progress-bar"><div id="pz-progress-fill" class="progress-fill"></div></div>
        <div id="pz-progress-text" class="progress-text">Preparando...</div>
      </div>

      <div class="preview-area">
        <div class="preview-card">
          <h3>Original</h3>
          <img id="pz-original" alt="Imagen original" />
        </div>
        <div class="preview-card">
          <h3>Sin fondo</h3>
          <img id="pz-result" alt="Resultado sin fondo" />
        </div>
      </div>

      <div class="actions">
        <button id="pz-process" type="button" class="btn-primary" disabled>Quitar fondo</button>
        <button id="pz-save" type="button" class="btn-primary" disabled>Guardar imagen</button>
      </div>
    `;

    const dropzone = container.querySelector<HTMLElement>("#pz-dropzone")!;
    const input = container.querySelector<HTMLInputElement>("#pz-input")!;
    const original = container.querySelector<HTMLImageElement>("#pz-original")!;
    const result = container.querySelector<HTMLImageElement>("#pz-result")!;
    const processBtn = container.querySelector<HTMLButtonElement>("#pz-process")!;
    const saveBtn = container.querySelector<HTMLButtonElement>("#pz-save")!;
    const status = container.querySelector<HTMLElement>("#pz-status")!;
    const progressWrap = container.querySelector<HTMLElement>("#pz-progress")!;
    const progressFill = container.querySelector<HTMLElement>("#pz-progress-fill")!;
    const progressText = container.querySelector<HTMLElement>("#pz-progress-text")!;

    const setStatus = (msg: string, error = false): void => {
      status.textContent = msg;
      status.classList.toggle("error", error);
    };

    const setProgress = (active: boolean, text = "", percent = 0): void => {
      progressWrap.classList.toggle("hidden", !active);
      progressText.textContent = text;
      progressFill.style.width = `${percent}%`;
    };

    const config: Config = {
      publicPath: "/imgly/",
      model: "isnet_quint8",
      device: "cpu",
      progress: (key, current, total) => {
        if (!mounted) return;
        const info = progressInfo(key, current, total);
        setProgress(true, info.text, info.percent);
      },
    };

    const loadFile = (file: File | undefined | null): void => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        processBtn.disabled = true;
        saveBtn.disabled = true;
        setStatus("El archivo seleccionado no es una imagen.", true);
        return;
      }
      inputFile = file;
      resultBlob = null;
      result.src = "";
      saveBtn.disabled = true;
      processBtn.disabled = false;
      original.src = urls.set("original", file);
      setStatus("Imagen cargada. Pulsa «Quitar fondo» para procesarla.");
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
      loadFile(e.dataTransfer?.files.item(0) ?? undefined);
    });
    input.addEventListener("change", () => loadFile(input.files?.item(0)));

    const preventNavigation = (e: DragEvent): void => e.preventDefault();
    window.addEventListener("dragover", preventNavigation);
    window.addEventListener("drop", preventNavigation);

    const loadPromise = preload(config).catch((err) => {
      console.debug("Precarga del modelo omitida:", err);
    });

    processBtn.addEventListener("click", async () => {
      if (!inputFile || processing) return;
      processing = true;
      processBtn.disabled = true;
      saveBtn.disabled = true;
      setProgress(true, "Preparando modelo e IA...", 5);
      setStatus("Procesando imagen, esto puede tomar unos segundos...");
      try {
        await loadPromise;
        if (!mounted) return;
        const blob = await removeBackground(inputFile, config);
        if (!mounted) return;
        resultBlob = blob;
        result.src = urls.set("result", blob);
        saveBtn.disabled = false;
        setStatus("¡Listo! El fondo se eliminó correctamente.");
      } catch (err) {
        if (!mounted) return;
        console.error(err);
        setStatus(`Error al procesar la imagen: ${(err as Error).message}`, true);
      } finally {
        if (mounted) setProgress(false);
        processBtn.disabled = false;
        processing = false;
      }
    });

    saveBtn.addEventListener("click", async () => {
      if (!resultBlob) return;
      const base = inputFile?.name.replace(/\.[^.]+$/, "") ?? "imagen";
      try {
        const path = await save({
          title: "Guardar imagen sin fondo",
          defaultPath: lastSaveDir || `${base}-sin-fondo.png`,
          filters: [{ name: "PNG", extensions: ["png"] }],
        });
        if (!path) return;
        await writeFile(path, new Uint8Array(await resultBlob.arrayBuffer()));
        lastSaveDir = dirnameFromPath(path);
        setStatus(`Guardada en: ${path}`);
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        if (/not allowed|scope/i.test(message)) {
          setStatus(
            "No se pudo guardar en esa ubicación. Prueba en Documentos, Imágenes, Descargas o el Escritorio.",
            true,
          );
        } else {
          setStatus(`Error al guardar: ${message}`, true);
        }
      }
    });

    dispose = () => {
      mounted = false;
      window.removeEventListener("dragover", preventNavigation);
      window.removeEventListener("drop", preventNavigation);
      urls.close();
    };
  },

  unmount() {
    dispose?.();
    dispose = undefined;
  },
};
