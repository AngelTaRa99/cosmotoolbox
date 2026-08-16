import { removeBackground, preload, type Config } from "@imgly/background-removal";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { ToolModule } from "../index";

const config: Config = {
  publicPath: "/imgly/",
  model: "isnet_quint8",
  device: "cpu",
  progress: (key: string, current: number, total: number) => {
    console.debug(`imgly ${key}: ${current}/${total}`);
  },
};

interface PhotoState {
  inputFile: File | null;
  resultBlob: Blob | null;
  objectUrls: string[];
}

const state: PhotoState = {
  inputFile: null,
  resultBlob: null,
  objectUrls: [],
};

function createUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  state.objectUrls.push(url);
  return url;
}

export const photoBackground: ToolModule = {
  mount(container) {
    state.inputFile = null;
    state.resultBlob = null;
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

    const loadFile = (file: File | undefined | null): void => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setStatus("El archivo seleccionado no es una imagen.", true);
        return;
      }
      state.inputFile = file;
      state.resultBlob = null;
      result.src = "";
      saveBtn.disabled = true;
      processBtn.disabled = false;
      original.src = createUrl(file);
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

    processBtn.addEventListener("click", async () => {
      if (!state.inputFile) return;
      processBtn.disabled = true;
      saveBtn.disabled = true;
      setProgress(true, "Preparando modelo e IA...", 5);
      setStatus("Procesando imagen, esto puede tomar unos segundos...");
      try {
        const blob = await removeBackground(state.inputFile, config);
        state.resultBlob = blob;
        result.src = createUrl(blob);
        saveBtn.disabled = false;
        setStatus("¡Listo! El fondo se eliminó correctamente.");
      } catch (err) {
        console.error(err);
        setStatus(`Error al procesar la imagen: ${(err as Error).message}`, true);
      } finally {
        setProgress(false);
        processBtn.disabled = false;
      }
    });

    saveBtn.addEventListener("click", async () => {
      if (!state.resultBlob) return;
      const base = state.inputFile?.name.replace(/\.[^.]+$/, "") ?? "imagen";
      try {
        const path = await save({
          title: "Guardar imagen sin fondo",
          defaultPath: `${base}-sin-fondo.png`,
          filters: [{ name: "PNG", extensions: ["png"] }],
        });
        if (!path) return;
        await writeFile(path, new Uint8Array(await state.resultBlob.arrayBuffer()));
        setStatus(`Guardada en: ${path}`);
      } catch (err) {
        setStatus(`Error al guardar: ${(err as Error).message}`, true);
      }
    });

    void preload(config).catch((err) => {
      console.debug("Precarga del modelo omitida:", err);
    });
  },

  unmount() {
    for (const url of state.objectUrls) {
      URL.revokeObjectURL(url);
    }
    state.objectUrls.length = 0;
  },
};
