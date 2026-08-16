import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  resolve: {
    alias: {
      // Solo usamos CPU; evita empaquetar el bundle/wasm de WebGPU (24MB)
      "onnxruntime-web/webgpu": "onnxruntime-web",
    },
  },

  plugins: [
    {
      name: "drop-ort-webgpu-wasm",
      apply: "build",
      generateBundle(_opts, bundle) {
        for (const key of Object.keys(bundle)) {
          if (key.includes("ort-wasm-simd-threaded.jsep")) {
            delete bundle[key];
            console.log("eliminado del bundle:", key);
          }
        }
      },
    },
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
