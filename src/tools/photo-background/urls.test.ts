import { describe, expect, it, vi } from "vitest";
import { SlotUrlManager } from "./urls";

describe("SlotUrlManager", () => {
  const blob = new Blob(["data"], { type: "image/png" });

  it("crea y almacena una URL por slot", () => {
    const manager = new SlotUrlManager(() => "blob:original", () => {});
    expect(manager.set("original", blob)).toBe("blob:original");
    expect(manager.get("original")).toBe("blob:original");
  });

  it("revoca la URL previa cuando se sobrescribe un slot", () => {
    const revoke = vi.fn();
    const manager = new SlotUrlManager(() => "blob:url", revoke);
    manager.set("original", blob);
    manager.set("original", blob);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:url");
  });

  it("revoca un slot individual", () => {
    const revoke = vi.fn();
    const manager = new SlotUrlManager(() => "blob:url", revoke);
    manager.set("result", blob);
    manager.revoke("result");
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(manager.get("result")).toBeUndefined();
  });

  it("close() revoca todo y bloquea la creación de nuevas URLs", () => {
    const revoke = vi.fn();
    const create = vi.fn(() => "blob:url");
    const manager = new SlotUrlManager(create, revoke);
    manager.set("result", blob);
    manager.close();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(manager.set("result", blob)).toBe("");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
