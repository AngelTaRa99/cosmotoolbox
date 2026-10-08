// src/tools/pdf-editor/history.ts
export class History<T> {
  private past: T[] = [];
  private present: T;
  private future: T[] = [];

  constructor(initial: T) {
    this.present = initial;
  }

  current(): T {
    return this.present;
  }

  set(state: T): void {
    this.past.push(this.present);
    this.present = state;
    this.future = [];
  }

  reset(state: T): void {
    this.past = [];
    this.present = state;
    this.future = [];
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): T | null {
    if (!this.canUndo()) return null;
    this.future.push(this.present);
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.present = prev;
    return this.present;
  }

  redo(): T | null {
    if (!this.canRedo()) return null;
    this.past.push(this.present);
    const next = this.future.pop();
    if (next === undefined) return null;
    this.present = next;
    return this.present;
  }
}
