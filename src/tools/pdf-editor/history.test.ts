// src/tools/pdf-editor/history.test.ts
import { describe, expect, it } from "vitest";
import { History } from "./history";

describe("History", () => {
  it("empieza en el estado inicial sin poder deshacer", () => {
    const h = new History("a");
    expect(h.current()).toBe("a");
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it("set empuja el estado anterior y permite deshacer", () => {
    const h = new History("a");
    h.set("b");
    expect(h.current()).toBe("b");
    expect(h.canUndo()).toBe(true);
    expect(h.undo()).toBe("a");
    expect(h.current()).toBe("a");
  });

  it("redo reaplica después de undo", () => {
    const h = new History("a");
    h.set("b");
    h.undo();
    expect(h.canRedo()).toBe(true);
    expect(h.redo()).toBe("b");
    expect(h.current()).toBe("b");
  });

  it("set limpia el futuro", () => {
    const h = new History("a");
    h.set("b");
    h.undo();
    h.set("c");
    expect(h.canRedo()).toBe(false);
    expect(h.current()).toBe("c");
  });

  it("reset limpia pasado y futuro sin dejar residuos", () => {
    const h = new History("a");
    h.set("b");
    h.set("c");
    h.undo();
    h.reset("z");
    expect(h.current()).toBe("z");
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it("undo en el fondo devuelve null y no cambia el estado", () => {
    const h = new History("a");
    expect(h.undo()).toBeNull();
    expect(h.current()).toBe("a");
  });

  it("soporta estados complejos (objetos)", () => {
    const h = new History({ n: 1 });
    h.set({ n: 2 });
    expect(h.current()).toEqual({ n: 2 });
    h.undo();
    expect(h.current()).toEqual({ n: 1 });
  });
});
