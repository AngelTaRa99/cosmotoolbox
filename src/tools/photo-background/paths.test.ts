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
