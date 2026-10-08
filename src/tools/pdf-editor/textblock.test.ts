// src/tools/pdf-editor/textblock.test.ts
import { describe, expect, it } from "vitest";
import { groupTextItems, type RawTextItem } from "./textblock";

const item = (
  str: string,
  x: number,
  y: number,
  width: number,
  fontSize = 12,
): RawTextItem => ({
  str,
  transform: [1, 0, 0, 1, x, y],
  width,
  height: fontSize,
  fontName: "g_d0_f1",
});

describe("groupTextItems", () => {
  it("fusiona items de la misma línea base en una sola línea", () => {
    const blocks = groupTextItems(
      [item("Hola ", 72, 700, 30), item("mundo", 102, 700, 30)],
      0,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toHaveLength(1);
    expect(blocks[0].lines[0].text).toBe("Hola mundo");
  });

  it("agrupa líneas cercanas verticalmente en un párrafo", () => {
    const blocks = groupTextItems(
      [item("primera línea", 72, 700, 80), item("segunda línea", 72, 685, 80)],
      0,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toHaveLength(2);
  });

  it("separa bloques cuando hay un salto vertical grande", () => {
    const blocks = groupTextItems(
      [item("arriba", 72, 700, 40), item("abajo", 72, 500, 40)],
      0,
    );
    expect(blocks).toHaveLength(2);
  });

  it("ignora items vacíos", () => {
    const blocks = groupTextItems([item("", 72, 700, 0), item("solo", 72, 700, 30)], 0);
    expect(blocks[0].lines[0].text).toBe("solo");
  });

  it("marca como no refluible un bloque con líneas desalineadas", () => {
    const blocks = groupTextItems(
      [item("izq", 72, 700, 30), item("muy a la derecha", 400, 685, 90)],
      0,
    );
    expect(blocks[0].reflowable).toBe(false);
  });

  it("expone geometría del bloque (left/top/bottom/width)", () => {
    const blocks = groupTextItems(
      [item("linea", 72, 700, 60)],
      0,
    );
    const b = blocks[0];
    expect(b.left).toBe(72);
    expect(b.width).toBe(60);
    expect(b.page).toBe(0);
    expect(b.top).toBeGreaterThanOrEqual(b.bottom);
  });
});
