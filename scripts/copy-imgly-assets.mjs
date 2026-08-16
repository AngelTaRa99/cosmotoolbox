import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorDir = join(root, "vendor");
const dataDir = join(vendorDir, "imgly-data", "dist");
const src = join(root, "public", "imgly");

const DATA_VERSION = "1.7.0";
const desiredKeys = [
  "/onnxruntime-web/ort-wasm-simd-threaded.wasm",
  "/onnxruntime-web/ort-wasm-simd-threaded.mjs",
  "/models/isnet_quint8",
];

async function ensureDataPackage() {
  try {
    const m = JSON.parse(await readFile(join(dataDir, "resources.json"), "utf8"));
    for (const key of desiredKeys) {
      if (!m[key]) throw new Error(`Falta recurso ${key} en el paquete local`);
    }
    console.log("Paquete de datos local OK (vendor/imgly-data).");
    return;
  } catch {
    console.log("Descargando datos de IA desde el CDN de IMG.LY...");
    const tgz = join(vendorDir, `imgly-data-${DATA_VERSION}.tgz`);
    const url = `https://staticimgly.com/@imgly/background-removal-data/${DATA_VERSION}/package.tgz`;
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`No se pudo descargar ${url}: HTTP ${response.status}`);
    }
    await pipeline(response.body, createWriteStream(tgz));
    await rm(dataDir, { recursive: true, force: true });
    await mkdir(dataDir, { recursive: true });
    const { execSync } = await import("node:child_process");
    execSync(`tar -xzf "${tgz}" -C "${dataDir}" --strip-components=2`);
    await rm(tgz);
  }
}

await ensureDataPackage();

const manifest = JSON.parse(await readFile(join(dataDir, "resources.json"), "utf8"));

const hashes = new Set();
for (const key of desiredKeys) {
  const entry = manifest[key];
  if (!entry) throw new Error(`Recurso no encontrado en el manifest: ${key}`);
  for (const chunk of entry.chunks) hashes.add(chunk.name);
}

await mkdir(src, { recursive: true });
await copyFile(join(dataDir, "resources.json"), join(src, "resources.json"));

for (const hash of hashes) {
  await copyFile(join(dataDir, hash), join(src, hash));
  console.log("copiado", hash);
}

console.log(`Listo: ${hashes.size} archivos copiados a public/imgly/`);
