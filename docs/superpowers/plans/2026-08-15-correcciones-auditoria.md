# Correcciones de auditoría (seguridad, leaks y lógica) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir los 11 hallazgos de la auditoría de CosmoToolbox (credenciales en texto plano, `withGlobalTauri`, scope FS amplio, gitignore de assets, dos leaks de object URLs, barra de progreso falsa, estado inconsistente al cargar no-imagenes, navegación al soltar fuera del dropzone, `preload` sin esperar y `defaultPath` relativo) sin cambiar la arquitectura ni el stack.

**Architecture:** Introducir un entorno de tests unitarios (vitest + node, sin jsdom) para poder verificar con TDD las correcciones extraíbles como lógica pura (gestión de object URLs, mapeo de progreso, extracción de directorio). La herramienta de fotos se reescribe para mover todo el estado a closures por-mount (en vez de estado de módulo compartido), gestionar los object URLs mediante un `SlotUrlManager` que revoca por slot y se "cierra" al desmontar, y proteger los handlers async con un flag `mounted`. Las correcciones de configuración (seguridad) se verifican por inspección + build.

**Tech Stack:** TypeScript 5.6 (strict), Vite 6, Tauri 2, `@imgly/background-removal` 1.7.0, `onnxruntime-web` 1.21.0, vitest ^3.

## Global Constraints

- Node 20, Vite 6, TS 5.6 strict (`noUnusedLocals`, `noUnusedParameters`, `isolatedModules`).
- Tauri 2, plugins `dialog`, `fs`, `opener` ya registrados — no añadir nuevos plugins Rust.
- Dependencias runtime: NO añadir ninguna nueva. Solo devDependency nueva: `vitest@^3.0.0`.
- UI en español, mismo estilo de clases CSS existentes; no tocar `styles.css`.
- Mantener la arquitectura actual: `ToolModule` (mount/unmount), registro en `src/tools/registry.ts` y `src/tools/index.ts`.
- No activar `device: "gpu"`, no tocar el alias `onnxruntime-web/webgpu` de `vite.config.ts` (fuera de alcance, anotado en el plan como trabajo futuro).
- Verificación de cada tarea: `npx tsc --noEmit`, `npx vitest run` (donde aplique) y `npm run build`.
- `isnet_quint8` se mantiene (tamaño pequeño para equipos de soporte); `isnet_fp16` queda anotado como mejora futura.
- Repo no versionado todavía: la Tarea 1 hace `git init` y el primer commit ya con `.gitignore` corregido para no commitear los 380MB de assets regenerables.

---

### Task 1: Inicializar git y excluir assets regenerables

**Files:**
- Modify: `.gitignore` (añadir entradas al final)

**Interfaces:**
- Produces: repo git con commit base limpio; los assets `public/imgly/` y `vendor/` quedan fuera del control de versiones.

- [ ] **Step 1: Verificar que no existe repo git**

Run: `git rev-parse --is-inside-work-tree`
Expected: `fatal: not a git repository` (o similar). Si ya es un repo, saltar el `git init` y pasar al Step 3.

- [ ] **Step 2: Inicializar el repositorio**

Run: `git init` (en `/mnt/Storage1_Disco/Proyectos/CosmoToolbox`)
Expected: `Initialized empty Git repository in ...`

- [ ] **Step 3: Añadir assets regenerables a `.gitignore`**

Append al final de `/mnt/Storage1_Disco/Proyectos/CosmoToolbox/.gitignore`:

```gitignore

# Assets de IA regenerables con `npm run setup:assets`
public/imgly
vendor
```

- [ ] **Step 4: Commit base**

Run:
```bash
git add .gitignore src src-tauri package.json package-lock.json index.html tsconfig.json vite.config.ts scripts/copy-imgly-assets.mjs docs
git status
```
Verifica en `git status` que **NO** aparecen `public/imgly/`, `vendor/` ni `node_modules/`. Después:

```bash
git commit -m "chore: commit base de CosmoToolbox tras la auditoría"
```

- [ ] **Step 5: Verificar el commit**

Run: `git log --oneline -1`
Expected: `chore: commit base de CosmoToolbox tras la auditoría`

---

### Task 2: Infraestructura de tests (vitest)

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts + devDependency)
- Create: `src/smoke.test.ts`

**Interfaces:**
- Produces: comando `npm test` que ejecuta vitest en entorno `node`, incluyendo ficheros `src/**/*.test.ts`.

- [ ] **Step 1: Instalar vitest**

Run: `npm i -D vitest@^3.0.0` (en `/mnt/Storage1_Disco/Proyectos/CosmoToolbox`)
Expected: aparece `vitest` en `devDependencies` de `package.json`.

- [ ] **Step 2: Crear `vitest.config.ts`**

Crear `/mnt/Storage1_Disco/Proyectos/CosmoToolbox/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Añadir scripts de test a `package.json`**

En `package.json`, dentro de `scripts`, añadir:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: Crear test smoke**

Crear `/mnt/Storage1_Disco/Proyectos/CosmoToolbox/src/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("verifies the test runner works", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Ejecutar los tests**

Run: `npm test`
Expected: `Test Files 1 passed`, `Tests 1 passed`.

- [ ] **Step 6: Verificar que `tsc` y el build siguen limpios**

Run: `npm run build`
Expected: compila sin errores (los ficheros `.test.ts` están en `src/` y los typecheckea `tsc`).

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/smoke.test.ts
git commit -m "test: añadir vitest como infraestructura de tests"
```

---

### Task 3: Gestión de object URLs sin fugas (módulo puro)

**Files:**
- Create: `src/tools/photo-background/urls.ts`
- Test: `src/tools/photo-background/urls.test.ts`

**Interfaces:**
- Produces: `class SlotUrlManager` con constructor opcional `(createObjectUrl?: (blob: Blob) => string, revokeObjectUrl?: (url: string) => void)` y métodos:
  - `set(slot: string, blob: Blob): string` — revoca el valor anterior del slot, crea la URL, la guarda y la devuelve. Si el manager está cerrado, NO crea ninguna URL y devuelve `""`.
  - `get(slot: string): string | undefined`
  - `revoke(slot: string): void`
  - `revokeAll(): void`
  - `close(): void` — revoca todo y bloquea futuros `set()` (devuelven `""`).

- [ ] **Step 1: Escribir el test fallido**

Crear `/mnt/Storage1_Disco/Proyectos/CosmoToolbox/src/tools/photo-background/urls.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { SlotUrlManager } from "./urls";

describe("SlotUrlManager", () => {
  const blob = new Blob(["data"], { type: "image/png" });

  it("crea y almacena una URL por slot", () => {
    const manager = new SlotUrlManager(() => "blob:original", () => {});
    expect(manager.set("original", blob)).toBe("blob:original");
    expect(manager.get("original")).toBe("blob:original");
  });

  it("revoca la URL previa cuando se sobrescribe un slot", () => {
    const revoke = vi.fn();
    const manager = new SlotUrlManager(() => "blob:url", revoke);
    manager.set("original", blob);
    manager.set("original", blob);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:url");
  });

  it("revoca un slot individual", () => {
    const revoke = vi.fn();
    const manager = new SlotUrlManager(() => "blob:url", revoke);
    manager.set("result", blob);
    manager.revoke("result");
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(manager.get("result")).toBeUndefined();
  });

  it("close() revoca todo y bloquea la creación de nuevas URLs", () => {
    const revoke = vi.fn();
    const create = vi.fn(() => "blob:url");
    const manager = new SlotUrlManager(create, revoke);
    manager.set("result", blob);
    manager.close();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(manager.set("result", blob)).toBe("");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npx vitest run src/tools/photo-background/urls.test.ts`
Expected: FAIL con `Cannot find module './urls'`.

- [ ] **Step 3: Implementar el módulo**

Crear `/mnt/Storage1_Disco/Proyectos/CosmoToolbox/src/tools/photo-background/urls.ts`:

```ts
export class SlotUrlManager {
  private slots = new Map<string, string>();
  private closed = false;

  constructor(
    private readonly createObjectUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
    private readonly revokeObjectUrl: (url: string) => void = (url) => URL.revokeObjectURL(url),
  ) {}

  set(slot: string, blob: Blob): string {
    if (this.closed) return "";
    this.revoke(slot);
    const url = this.createObjectUrl(blob);
    this.slots.set(slot, url);
    return url;
  }

  get(slot: string): string | undefined {
    return this.slots.get(slot);
  }

  revoke(slot: string): void {
    const url = this.slots.get(slot);
    if (url !== undefined) {
      this.revokeObjectUrl(url);
      this.slots.delete(slot);
    }
  }

  revokeAll(): void {
    for (const url of this.slots.values()) this.revokeObjectUrl(url);
    this.slots.clear();
  }

  close(): void {
    this.revokeAll();
    this.closed = true;
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npx vitest run src/tools/photo-background/urls.test.ts`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/photo-background/urls.ts src/tools/photo-background/urls.test.ts
git commit -m "fix: gestión de object URLs con revocación por slot y cierre"
```

---

### Task 4: Barra de progreso real (mapeo de progreso puro)

**Files:**
- Create: `src/tools/photo-background/progress.ts`
- Test: `src/tools/photo-background/progress.test.ts`

**Interfaces:**
- Consumes: el callback de imgly `progress(key: string, current: number, total: number)` (confirmado en `schema.d.ts`: claves `fetch:${recurso}` y `compute:${fase}`).
- Produces: `interface ProgressInfo { text: string; percent: number }` y `function progressInfo(key: string, current: number, total: number): ProgressInfo`.

Reglas de mapeo:
- `fetch:*` → `text: "Descargando <nombre>... <pct>%"`, `percent: round(current/total*100)` (0 si `total <= 0`).
- `compute:*` → `text: "Procesando imagen..."`, `percent: 90 + round(current/total*10)` (90 si `total <= 0`).
- resto → `text: "Preparando..."`, `percent: 0`.

- [ ] **Step 1: Escribir el test fallido**

Crear `/mnt/Storage1_Disco/Proyectos/CosmoToolbox/src/tools/photo-background/progress.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { progressInfo } from "./progress";

describe("progressInfo", () => {
  it("mapea fetch al porcentaje de descarga", () => {
    expect(progressInfo("fetch:/models/isnet_quint8", 25, 100)).toEqual({
      text: "Descargando isnet_quint8... 25%",
      percent: 25,
    });
  });

  it("protege contra totales cero en fetch", () => {
    expect(progressInfo("fetch:/models/isnet_quint8", 0, 0).percent).toBe(0);
  });

  it("mapea compute cerca de completarse", () => {
    expect(progressInfo("compute:decode", 3, 4)).toEqual({
      text: "Procesando imagen...",
      percent: 98,
    });
  });

  it("devuelve un fallback para claves desconocidas", () => {
    expect(progressInfo("weird", 1, 1)).toEqual({ text: "Preparando...", percent: 0 });
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npx vitest run src/tools/photo-background/progress.test.ts`
Expected: FAIL con `Cannot find module './progress'`.

- [ ] **Step 3: Implementar el módulo**

Crear `/mnt/Storage1_Disco/Proyectos/CosmoToolbox/src/tools/photo-background/progress.ts`:

```ts
export interface ProgressInfo {
  text: string;
  percent: number;
}

export function progressInfo(key: string, current: number, total: number): ProgressInfo {
  if (key.startsWith("fetch:")) {
    const name = key.slice(key.lastIndexOf("/") + 1) || "modelo";
    const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    return { text: `Descargando ${name}... ${percent}%`, percent };
  }
  if (key.startsWith("compute:")) {
    const percent = total > 0 ? Math.min(100, 90 + Math.round((current / total) * 10)) : 90;
    return { text: "Procesando imagen...", percent };
  }
  return { text: "Preparando...", percent: 0 };
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npx vitest run src/tools/photo-background/progress.test.ts`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/photo-background/progress.ts src/tools/photo-background/progress.test.ts
git commit -m "fix: barra de progreso real a partir del callback de imgly"
```

---

### Task 5: Extracción de directorio de una ruta (módulo puro)

**Files:**
- Create: `src/tools/photo-background/paths.ts`
- Test: `src/tools/photo-background/paths.test.ts`

**Interfaces:**
- Produces: `function dirnameFromPath(path: string): string` — devuelve la parte de directorio de una ruta Windows o POSIX, o `""` si no hay separador.

- [ ] **Step 1: Escribir el test fallido**

Crear `/mnt/Storage1_Disco/Proyectos/CosmoToolbox/src/tools/photo-background/paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dirnameFromPath } from "./paths";

describe("dirnameFromPath", () => {
  it("maneja rutas Windows", () => {
    expect(dirnameFromPath("C:\\Users\\angelo\\Desktop\\foto.png")).toBe("C:\\Users\\angelo\\Desktop");
  });

  it("maneja rutas POSIX", () => {
    expect(dirnameFromPath("/home/angelo/Pictures/foto.png")).toBe("/home/angelo/Pictures");
  });

  it("devuelve cadena vacía si no hay directorio", () => {
    expect(dirnameFromPath("foto.png")).toBe("");
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npx vitest run src/tools/photo-background/paths.test.ts`
Expected: FAIL con `Cannot find module './paths'`.

- [ ] **Step 3: Implementar el módulo**

Crear `/mnt/Storage1_Disco/Proyectos/CosmoToolbox/src/tools/photo-background/paths.ts`:

```ts
export function dirnameFromPath(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index === -1 ? "" : path.slice(0, index);
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npx vitest run src/tools/photo-background/paths.test.ts`
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/photo-background/paths.ts src/tools/photo-background/paths.test.ts
git commit -m "fix: helper de directorio para el diálogo de guardado"
```

---

### Task 6: Reescribir la herramienta de fotos (leaks + lógica)

**Files:**
- Rewrite: `src/tools/photo-background/index.ts`
- Consumes: `SlotUrlManager` (Task 3), `progressInfo` (Task 4), `dirnameFromPath` (Task 5)

**Interfaces:**
- Consumes: `ToolModule` de `src/tools/index.ts` (sin cambios).
- Produces: módulo `photoBackground: ToolModule` con `mount(container)` y `unmount()` que no fuga URLs ni deja listeners globales colgados.

**Cambios respecto al código actual:**
1. Todo el estado pasa a closures por-mount (`inputFile`, `resultBlob`, `processing`, `lastSaveDir`) — se elimina el `state` de nivel de módulo y `createUrl`.
2. `SlotUrlManager` por-mount: `urls.set("original", file)` y `urls.set("result", blob)` revocan el valor previo del slot. `unmount()` hace `urls.close()` (revoca todo y bloquea `set` → el handler async tardío ya no puede crear URLs huérfanas).
3. Flag `mounted`: todo handler async comprueba `if (!mounted) return;` antes de tocar el DOM/URLs.
4. Barra de progreso real con `config.progress` → `progressInfo`.
5. `loadFile` con archivo no-imagen: deshabilita `processBtn`/`saveBtn` (estado consistente).
6. Listeners globales `dragover`/`drop` con `preventDefault` en `mount()`, retirados en `unmount()`.
7. `preload` guardado en `loadPromise` y esperado en el handler de procesar.
8. Guardado: `defaultPath` recuerda el último directorio; error de scope traducido a mensaje útil.

- [ ] **Step 1: Reescribir `src/tools/photo-background/index.ts`**

Reemplazar el contenido completo de `/mnt/Storage1_Disco/Proyectos/CosmoToolbox/src/tools/photo-background/index.ts` por:

```ts
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
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores. (Confirma además que `src/tools/index.ts` y `registry.ts` no cambian.)

- [ ] **Step 3: Ejecutar todos los tests**

Run: `npm test`
Expected: `Test Files 4 passed` (smoke + urls + progress + paths), todos verdes.

- [ ] **Step 4: Verificar build de producción**

Run: `npm run build`
Expected: `tsc` limpio y Vite emite `dist/` sin errores.

- [ ] **Step 5: Verificación manual (Tauri)**

Run: `npm run tauri dev` y comprobar:
1. Cargar una imagen → se muestra el preview original; el botón «Quitar fondo» se habilita.
2. Pulsar «Quitar fondo» → la barra de progreso avanza con porcentajes reales (Descargando modelo... x%) en la primera ejecución.
3. Al terminar → aparece el preview sin fondo y «Guardar imagen» se habilita.
4. Guardar → se guarda; la segunda vez, el diálogo abre en el último directorio usado.
5. Durante el procesado, pulsar «Inicio» → no hay errores ni pantalla blanca; volver a la herramienta y procesar funciona.
6. Soltar una imagen FUERA del dropzone → la app NO navega (se queda en la misma vista).
7. Cargar un archivo que no es imagen → muestra error y ambos botones quedan deshabilitados.
8. En DevTools (Memoria / Network): tras cargar y procesar varias imágenes, no se acumulan `blob:` URLs sin revocar.

- [ ] **Step 6: Commit**

```bash
git add src/tools/photo-background/index.ts
git commit -m "fix: leaks de object URLs, estado por-mount, progreso real y prevención de navegación al soltar"
```

---

### Task 7: Seguridad — desactivar `withGlobalTauri` y restringir scope FS

**Files:**
- Modify: `src-tauri/tauri.conf.json:13`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces: frontend sin API global expuesta; el plugin-fs solo puede escribir en Documentos/Imágenes/Descargas/Escritorio.

- [ ] **Step 1: Cambiar `withGlobalTauri` a `false`**

En `src-tauri/tauri.conf.json`, cambiar:

```json
    "withGlobalTauri": true,
```

por:

```json
    "withGlobalTauri": false,
```

(El frontend ya importa los plugins con `import { save } from "@tauri-apps/plugin-dialog"` y `import { writeFile } from "@tauri-apps/plugin-fs"`, así que `window.__TAURI__` no se usa.)

- [ ] **Step 2: Restringir el scope de escritura FS**

En `src-tauri/capabilities/default.json`, reemplazar el bloque `fs:allow-write-file`:

```json
    {
      "identifier": "fs:allow-write-file",
      "allow": [
        { "path": "$HOME/**" },
        { "path": "$DESKTOP/**" },
        { "path": "$DOCUMENT/**" },
        { "path": "$DOWNLOAD/**" },
        { "path": "$PICTURE/**" }
      ]
    }
```

por:

```json
    {
      "identifier": "fs:allow-write-file",
      "allow": [
        { "path": "$DESKTOP/**" },
        { "path": "$DOCUMENT/**" },
        { "path": "$DOWNLOAD/**" },
        { "path": "$PICTURE/**" }
      ]
    }
```

Nota: quitar `$HOME/**` significa que guardar fuera de esas 4 carpetas fallará; el Task 6 ya muestra un mensaje útil para ese caso.

- [ ] **Step 3: Verificar config**

Run: `npm run tauri build -- --no-bundle`
Expected: Rust compila sin errores y Tauri valida `tauri.conf.json` + capabilities.

Alternativa (si Rust no está disponible en este entorno):
```bash
python3 -c "import json; json.load(open('src-tauri/tauri.conf.json')); json.load(open('src-tauri/capabilities/default.json')); print('JSON válido')"
```
Expected: imprime `JSON válido`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "security: desactivar withGlobalTauri y restringir el scope de escritura FS"
```

---

### Task 8: Seguridad — eliminar credenciales en texto plano del script NAS

**Files:**
- Rewrite: `scripts/nas-ssh.ps1`

**Interfaces:**
- Consumes: nada.
- Produces: script que lee `NAS_HOST`, `NAS_USER` y `NAS_PASS` de variables de entorno y falla con mensaje claro si faltan.

- [ ] **Step 1: Reescribir `scripts/nas-ssh.ps1`**

Reemplazar el contenido completo de `/mnt/Storage1_Disco/Proyectos/CosmoToolbox/scripts/nas-ssh.ps1` por:

```powershell
param(
  [Parameter(Mandatory = $true)]
  [string]$RemoteCommand
)

$ErrorActionPreference = "Stop"
Import-Module Posh-SSH

$hostIp = $env:NAS_HOST
$hostUser = $env:NAS_USER
$hostPass = $env:NAS_PASS

if (-not $hostIp -or -not $hostUser -or -not $hostPass) {
  Write-Error "Faltan credenciales. Define las variables de entorno NAS_HOST, NAS_USER y NAS_PASS antes de ejecutar este script."
}

$pass = ConvertTo-SecureString $hostPass -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($hostUser, $pass)
$session = New-SSHSession -ComputerName $hostIp -Credential $cred -AcceptKey -ConnectionTimeout 20 -ErrorAction Stop
try {
  $result = Invoke-SSHCommand -SessionId $session.SessionId -Command $RemoteCommand
  $result.Output
  if ($result.ExitStatus -ne 0) {
    Write-Output ("EXIT_NONZERO: " + $result.ExitStatus)
  }
  $result.Error
} finally {
  Remove-SSHSession -SessionId $session.SessionId -ErrorAction SilentlyContinue | Out-Null
}
```

- [ ] **Step 2: Verificar que no quedan credenciales**

Run:
```bash
grep -nE "192\.168\.1\.150|alondr49" scripts/nas-ssh.ps1
grep -n "hostPass\|hostIp\|hostUser" scripts/nas-ssh.ps1
```
Expected: el primer grep NO imprime `192.168.1.150` ni `alondr49` (no quedan credenciales literales). El segundo grep solo imprime las 3 líneas de asignación desde variables de entorno (`= $env:NAS_...`), sin valores literales.

> Nota (ajuste aprobado por el usuario): el comando original del plan (`grep -nE "...|hostPass\s*=|hostIp\s*="`) coincidía también con `$hostPass = $env:...`, produciendo un falso positivo. Se sustituye por la doble verificación de arriba.

- [ ] **Step 3: Commit**

```bash
git add scripts/nas-ssh.ps1
git commit -m "security: eliminar credenciales en texto plano del script NAS (usa variables de entorno)"
```

---

### Task 9: Barrido final de verificación

**Files:**
- Ninguno (solo comprobaciones).

- [ ] **Step 1: Typecheck y tests completos**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: `tsc` sin errores, `Test Files 4 passed`, build de producción completo.

- [ ] **Step 2: Confirmar que no quedan hallazgos de la auditoría**

Run:
```bash
grep -rn "withGlobalTauri" src-tauri/tauri.conf.json
grep -rn "\$HOME/\*\*" src-tauri/capabilities/default.json
grep -rnE "192\.168\.1\.150|alondr49" scripts/nas-ssh.ps1
```
Expected: `withGlobalTauri` aparece como `false`; `$HOME/**` NO aparece en capabilities; y el grep del script NAS no devuelve la IP ni la contraseña.

- [ ] **Step 3: Comprobar el historial de commits**

Run: `git log --oneline`
Expected: 9 commits (base + vitest + urls + progress + paths + index.ts + tauri.conf/capabilities + nas-ssh), uno por tarea.

---

## Trabajo futuro (fuera de alcance de este plan)

- `device: "gpu"` con WebGPU (el alias `onnxruntime-web/webgpu` en `vite.config.ts` habrá que ajustarlo) — ~20x más rápido según benchmarks de IMG.LY.
- `config.proxyToWorker: true` para no bloquear la UI durante la inferencia.
- Modelo `isnet_fp16` (mejores bordes, tamaño similar) si la calidad de `isnet_quint8` no es suficiente.
- Auto-updater (`tauri-plugin-updater`), `window-state` y `store` para persistir ajustes.
