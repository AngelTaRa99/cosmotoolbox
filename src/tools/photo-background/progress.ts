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
