// src/tools/pdf-editor/save.ts
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { dirnameFromPath } from "../photo-background/paths";

export async function savePdf(bytes: Uint8Array, suggestedName: string): Promise<string | null> {
  const path = await save({
    title: "Guardar PDF editado",
    defaultPath: suggestedName,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return null;
  await writeFile(path, bytes);
  return path;
}

export { dirnameFromPath };
