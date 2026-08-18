# CosmoToolbox

Caja de herramientas portable para soporte tecnico, construida con Tauri v2.

## Herramientas

- **Corrector de fotos** — Elimina el fondo de imagenes usando IA local (ONNX Runtime Web + ISNet). No requiere conexion a internet.

## Stack

| Capa | Tecnologia |
|------|-----------|
| Frontend | TypeScript + Vite (sin framework) |
| Backend | Rust (Tauri v2) |
| IA | @imgly/background-removal + onnxruntime-web (CPU/WASM) |

## Requisitos

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://www.rust-lang.org/tools/install) (edition 2021)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/) v2

## Setup

```bash
# Instalar dependencias del frontend
npm install

# Descargar modelo de IA (~120MB)
npm run setup:assets

# Desarrollo
npm run tauri dev

# Build de produccion
npm run tauri build
```

## Estructura

```
src/
  main.ts                    # Router SPA, renderizado de vistas
  styles.css                 # Tema oscuro, grid responsive
  tools/
    registry.ts              # Metadata de herramientas (agregar aqui)
    icons.ts                 # Iconos SVG por tipo de herramienta
    index.ts                 # Interfaz ToolModule + registro de modulos
    photo-background/
      index.ts               # Corrector de fotos (removeBackground)
src-tauri/
  src/lib.rs                 # Builder Tauri + plugins
  capabilities/default.json  # Permisos de seguridad
scripts/
  copy-imgly-assets.mjs      # Descarga modelo IA desde CDN
```

## Agregar una herramienta

1. Crear `src/tools/mi-herramienta/index.ts` que implemente `ToolModule`:
   ```typescript
   import type { ToolModule } from "../index";

   export const miHerramienta: ToolModule = {
     mount(container) { /* render UI */ },
     unmount() { /* limpiar recursos */ },
   };
   ```

2. Agregar metadata en `src/tools/registry.ts`:
   ```typescript
   { id: "mi-herramienta", name: "Mi Herramienta", description: "...", icon: "photo" }
   ```

3. Registrar el modulo en `src/tools/index.ts`:
   ```typescript
   import { miHerramienta } from "./mi-herramienta";
   // Agregar a toolModules: { "mi-herramienta": miHerramienta }
   ```

## Licencia

MIT — ver [LICENSE](./LICENSE).
