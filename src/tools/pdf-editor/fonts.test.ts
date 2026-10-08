// src/tools/pdf-editor/fonts.test.ts
import { describe, expect, it } from "vitest";
import { classifyFont, mostCommon, DEFAULT_FONT_CLASS } from "./fonts";

describe("classifyFont", () => {
  it("detecta serif (Times)", () => {
    expect(classifyFont("TimesNewRoman")).toBe("serif");
    expect(classifyFont("LiberationSerif")).toBe("serif");
    expect(classifyFont("Georgia")).toBe("serif");
  });

  it("detecta sans (Helvetica/Arial)", () => {
    expect(classifyFont("Helvetica")).toBe("sans");
    expect(classifyFont("Arial")).toBe("sans");
    expect(classifyFont("Calibri")).toBe("sans");
  });

  it("detecta mono (Courier)", () => {
    expect(classifyFont("Courier")).toBe("mono");
    expect(classifyFont("Consolas")).toBe("mono");
    expect(classifyFont("LiberationMono")).toBe("mono");
  });

  it("quita el prefijo de subset (ABCDEF+)", () => {
    expect(classifyFont("ABCDEF+Arial")).toBe("sans");
  });

  it("desconocido cae a la clase por defecto", () => {
    expect(classifyFont("WeirdFont123")).toBe(DEFAULT_FONT_CLASS);
  });
});

describe("mostCommon", () => {
  it("elige la clase más frecuente", () => {
    expect(mostCommon(["sans", "sans", "serif"])).toBe("sans");
  });

  it("lista vacía devuelve la por defecto", () => {
    expect(mostCommon([])).toBe(DEFAULT_FONT_CLASS);
  });
});
