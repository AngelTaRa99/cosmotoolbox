# Editor de PDF — Diseño

Fecha: 2026-10-08
Estado: Aprobado (pendiente de revisión del usuario)

## Objetivo

Añadir a CosmoToolbox una herramienta "Editor de PDF" que permita **editar el
texto existente de un PDF con reflujo a nivel de párrafo**: al cambiar una
línea, el resto del párrafo se reajusta a la nueva longitud y los bloques
inferiores de la página se desplazan para acomodar el cambio.

Este diseño surge del análisis inverso (REA) de `pdfeditor.exe` de PDFgear
(v2.1.13.0). Ver "Apéndice: hallazgos de ingeniería inversa" al final.

## Alcance de la v1

**Incluido:**
- Abrir un PDF (diálogo nativo vía `@tauri-apps/plugin-dialog`).
- Renderizar páginas con navegación y zoom.
- Modelo de párrafos derivado de la capa de texto de PDF.js.
- Edición de texto existente con reflujo de párrafo (los bloques inferiores se
  desplazan).
- Insertar texto nuevo en una posición (overlay).
- Deshacer/rehacer.
- Guardar el PDF modificado (vía `@tauri-apps/plugin-fs`).

**Fuera de alcance de la v1:**
- Edición de contenido de página "quirúrgica" (eliminar glifos del content
  stream). Se usa *whiteout + redibujado*, no cirugía de streams.
- Reflujo a nivel de página/documento tipo procesador de textos.
- Edición de imágenes, tablas, formularios, anotaciones, capas OCR, firmas.
- Multi-columna compleja / detección de maquetación avanzada.

## Modelo de datos

```
TextBlock  = párrafo (líneas ordenadas)      ← unidad de edición y reflujo
  TextLine = una línea de base (runs)         ← tiene Y, fuente, tamaño, color
    TextRun= clúster de glifos + posición x   ← unidad atómica de dibujo
```

`TextBlock` lleva además: `width` (ancho de columna), `left` (borde izquierdo),
`top`, `lineHeight`, `align` (left/center/right) y `indent`.

## Arquitectura y componentes

Sigue el patrón existente de `photo-background` (dropzone → proceso → guardar).

Registro:
- `src/tools/registry.ts` — añadir herramienta `pdf-editor` (icono `pdf`).
- `src/tools/icons.ts` — añadir el SVG `pdf`.
- `src/tools/index.ts` — registrar el módulo.

Nuevo módulo `src/tools/pdf-editor/`:

| Archivo        | Responsabilidad                                            |
|----------------|------------------------------------------------------------|
| `index.ts`     | ToolModule shell: mount/unmount, cableado UI, estado/progreso |
| `document.ts`  | Cargar PDF (pdf-lib modelo + pdf.js render/texto)          |
| `viewer.ts`    | Render a `<canvas>`, navegación de páginas, zoom           |
| `textblock.ts` | Items de texto PDF.js → modelo `TextBlock`/`TextLine`/`TextRun` |
| `reflow.ts`    | **Núcleo** — re-ajustar párrafo + calcular desplazamiento (puro) |
| `editor.ts`    | Whiteout + redibujado del bloque vía pdf-lib                |
| `history.ts`   | Deshacer/rehacer (patrón snapshot/comando)                 |
| `save.ts`      | Serializar con pdf-lib, escribir vía Tauri fs               |

**Frontera clave:** `reflow.ts` es una **función pura** — recibe un `TextBlock`
+ una edición, devuelve líneas nuevas + desplazamiento vertical. No toca DOM,
canvas ni pdf-lib. Esto hace que la parte difícil sea testeable de forma
aislada.

## Flujo de datos

**Cargar**
1. El usuario suelta/abre un PDF → `plugin-dialog` elige archivo → `plugin-fs`
   lee los bytes.
2. `document.ts` carga dos vistas de los mismos bytes:
   - **pdf-lib `PDFDocument`** — el modelo editable (dibujar + guardar).
   - **pdf.js `PDFDocumentProxy`** — la fuente de render/texto (por página:
     render a canvas + `getTextContent()`).
3. `viewer.ts` renderiza la página 1; `textblock.ts` construye el modelo de
   párrafos de la página actual.

**Editar (ruta de reflujo)**
1. El usuario hace clic en un run de texto → resaltamos su `TextBlock` padre.
2. Se abre un editor en línea sobre el bloque (contenteditable dimensionado).
3. Al confirmar, `reflow.ts`: re-ajusta el texto nuevo al ancho de columna del
   bloque usando las métricas de la fuente original → produce **líneas nuevas**
   + un **delta de desplazamiento**.
4. `editor.ts` lo aplica con pdf-lib: **whiteout** del bbox original, **dibuja**
   las líneas nuevas desde el borde superior del bloque, y si delta ≠ 0,
   **desplaza todos los bloques inferiores** de esa página por el delta.
5. Re-renderizar la página; push de snapshot para deshacer.

**Guardar**
- `save.ts`: `pdfDoc.save()` → bytes → `plugin-fs` `writeFile` → estado confirma
  la ruta.

**Deshacer/rehacer**
- `history.ts` mantiene una pila de snapshots de estado de bloque (pre/post
  edición). Deshacer restaura el snapshot anterior y re-renderiza.

## El motor de reflujo (`reflow.ts`)

Función pura, sin DOM/canvas/pdf-lib. Aquí vive el comportamiento "los
vecinos se ajustan".

**Entrada:** un `TextBlock` (ancho de columna, líneas actuales, fuente/tamaño/
color) + el texto nuevo del usuario para una línea concreta.
**Salida:** nuevas `TextLine[]` + `shiftDelta` (px a mover los bloques
inferiores).

**Algoritmo:**
1. **Medir** — función `measure(text, font, size) → px`. Inyectada como
   dependencia (los tests pasan un stub; producción usa canvas `measureText`).
   Inyectarla es lo que hace el reflujo testeable sin navegador.
2. **Re-ajustar** — tomar el texto completo del párrafo con la edición aplicada,
   ajustar palabras de forma voraz al ancho del bloque, produciendo líneas
   nuevas. Preservar el sangrado de la primera línea y el borde izquierdo.
3. **Alinear** — heredar la justificación (left/center/right) de cada línea
   original respecto al bloque.
4. **Desplazar** — `newHeight = newLines.length * lineHeight`;
   `shiftDelta = newHeight - originalHeight`. Las líneas inferiores se mueven
   exactamente `shiftDelta`.

**Lo que deliberadamente NO hace:** re-tipografiar entre páginas, re-ajustar
imágenes/tablas, o re-envolver texto posicionado a mano (coordenadas absolutas
lejos de la columna del bloque). Para esos casos detectamos "no es un párrafo
normal" y caemos a **reemplazo in-place** (sin desplazamiento) para nunca
corromper la maquetación.

## Fuentes y casos límite

**Resolución de fuente (por bloque editado):**
1. Pedir a pdf-lib el nombre de la fuente original del run.
2. Intentar `pdfDoc.embedFont(<bytes propios de la fuente>)` — reutiliza la
   **fuente embebida**. Si la fuente es un **subset** sin los glifos nuevos,
   pdf-lib lanza error →
3. Caer a una **fuente estándar** emparejada (Helvetica/Times/Courier según la
   clase serif/sans/mono original) al tamaño original, para que el ancho se
   mantenga cercano.

**Casos límite:**
- **Texto rotado / vertical** → detectar transform no horizontal; sin reflujo,
  solo reemplazo in-place (o se deja intacto).
- **Runs posicionados a mano** (glifos lejos del borde izquierdo / huecos
  grandes) → no es párrafo normal → reemplazo in-place, sin desplazamiento.
- **Fuente embebida ausente** → caída a fuente estándar.
- **Multi-columna / celdas de tabla** → el ancho de columna sale del bbox
  detectado; si no hay columna limpia, fallback sin desplazamiento.
- **Texto vacío / borrado** → el bloque se encoge; `shiftDelta` negativo.

**Política de fallo:** cualquier error del motor se captura en el límite de
`editor.ts` → la herramienta muestra un mensaje de estado en español (UX
`.status-msg.error` existente) y deja el documento sin cambios. Sin escrituras
parciales/corruptas — el guardado solo ocurre en acción explícita del usuario.

## Pruebas

Configuración existente de `vitest` (`npm test`).

**Unitarias (puras, sin navegador) — la mayoría:**
- `reflow.test.ts` — núcleo: re-ajuste produce las líneas esperadas;
  `shiftDelta` correcto para ediciones más altas/más cortas/vacías; preserva
  sangrado + alineación; fallback sin desplazamiento para entrada posicionada a
  mano/rotada. `measure()` es stub → determinista.
- `textblock.test.ts` — items PDF.js → agrupación correcta en
  `TextBlock`/`TextLine` (items en la misma línea base se fusionan; proximidad
  vertical agrupa líneas en párrafos).
- `history.test.ts` — pila deshacer/rehacer: push/undo/redo restaura snapshots.
- `fonts.test.ts` — ruta de éxito con fuente embebida + fallo de subset →
  selección de fuente estándar.

**Integración:**
- Cargar un PDF pequeño generado en el test (con pdf-lib), aplicar una edición
  de reflujo, `save()`, reabrir con pdf-lib, afirmar que el texto nuevo está
  presente y el bloque original está cubierto.

**Sin tests E2E de navegador** en la v1 — el render del canvas de PDF.js se
ejecuta manualmente; la *lógica* frágil (reflujo/agrupación/fuentes) es pura y
cubierta por unitarias.

## Apéndice: hallazgos de ingeniería inversa

Análisis con REA sobre `/PDFgear/pdfeditor.exe` (v2.1.13.0).

- **Tipo:** app WPF sobre .NET Framework 4.6.2 (x86_64, PE/CLI).
- **Motor PDF:** **no** reimplementa PDF; envuelve **PDFium** vía la librería C#
  `Patagames.Pdf` (wrapper sobre `pdfium.dll`). Render, extracción de texto,
  manipulación de páginas y anotaciones pasan por la API C `FPDF_*`. Evidencia:
  grafo de llamadas con `FPDF_LoadPage`, `FPDF_ClosePage`, y accesores de
  anotaciones/objetos de página.
- **Arquitectura:** MVVM (CommunityToolkit.Mvvm). Desacoplado en `Models`
  (datos + operaciones PDF), `ViewModels` (estado + comandos), `Controls` (vistas
  WPF), `Services`.
- **Superficie de edición** (~2.150 tipos):
  - Anotaciones: Highlight, Underline, Strikeout, Ink, Line, Square, Circle,
    FreeText, Text, Stamp, Link, Popup, Watermark, Attachment + fábrica.
  - Edición de contenido: `PageTextObject`, `PageImageModel`, `PageBaseObject`.
  - Operaciones de página: rotar, recortar, insertar, reordenar, borrar.
  - Visor: niveles de zoom, miniaturas, operaciones arrastrar/sobreponer.
  - Extras: OCR, IA "Copilot", firmas digitales, sellos, marcas de agua,
    impresión, escaneo, traducción, voz, marcadores, email.

**Decisión de diseño derivada:** PDFgear usa PDFium para *fidelidad de render*,
no para reflujo — la lógica de reflujo es propia en cualquier caso. Por eso no
necesitamos PDFium; PDF.js + pdf-lib logra el resultado visible para el usuario
con mucha menos fricción y encaja en la pila vanilla-TS + plugins Tauri
existente.
