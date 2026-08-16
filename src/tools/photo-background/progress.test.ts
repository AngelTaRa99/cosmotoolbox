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
