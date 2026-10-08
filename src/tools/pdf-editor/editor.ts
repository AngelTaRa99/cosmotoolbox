// src/tools/pdf-editor/editor.ts
import type { TextBlock, TextLine } from "./textblock";
import { reflowBlock, type MeasureFn, type ReflowLine } from "./reflow";

export type { MeasureFn };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextDraw {
  text: string;
  x: number;
  y: number;
  fontSize: number;
}

export interface EditRecord {
  page: number;
  whiteouts: Rect[];
  draws: TextDraw[];
}

const PAD = 2;

export function blockRect(block: TextBlock, pad = PAD): Rect {
  // Cubre los glifos: de descenderes bajo la última línea base (block.bottom
  // ya incluye 0.25·fontSize) hasta la ascendente sobre la primera
  // (block.top es la primera línea base, no el borde del glifo).
  return {
    x: block.left - pad,
    y: block.bottom - pad,
    width: block.width + pad * 2,
    height: block.top + block.fontSize * 0.8 - block.bottom + pad * 2,
  };
}

export function lineToDraws(line: TextLine | ReflowLine): TextDraw {
  return { text: line.text, x: line.x, y: line.y, fontSize: line.fontSize };
}

export function planReflowEdit(
  edited: TextBlock,
  newText: string,
  belowBlocks: TextBlock[],
  measure: MeasureFn,
): EditRecord | null {
  if (!edited.reflowable) return null;

  const result = reflowBlock(edited, newText, measure);
  if (!result.canReflow) return null;

  const whiteouts: Rect[] = [blockRect(edited)];
  const draws: TextDraw[] = result.lines.map(lineToDraws);

  if (Math.abs(result.shiftDelta) > 0.01) {
    const belowSorted = [...belowBlocks]
      .filter((b) => b.reflowable)
      .sort((a, b) => b.top - a.top);
    for (const below of belowSorted) {
      whiteouts.push(blockRect(below));
      // y-up: shiftDelta > 0 = el bloque creció hacia abajo, entonces el
      // contenido inferior debe bajar (y disminuye) → restamos el delta.
      for (const line of below.lines) {
        draws.push({ ...lineToDraws(line), y: line.y - result.shiftDelta });
      }
    }
  }

  return { page: edited.page, whiteouts, draws };
}
