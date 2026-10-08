// src/tools/pdf-editor/reflow.ts
import type { TextBlock } from "./textblock";

export type MeasureFn = (text: string, fontSize: number) => number;

export interface ReflowLine {
  text: string;
  x: number;
  y: number;
  fontSize: number;
}

export interface ReflowResult {
  canReflow: boolean;
  lines: ReflowLine[];
  shiftDelta: number;
}

function wrap(
  words: string[],
  firstMax: number,
  otherMax: number,
  fontSize: number,
  measure: MeasureFn,
): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const trial = cur === "" ? word : `${cur} ${word}`;
    const limit = lines.length === 0 ? firstMax : otherMax;
    if (cur === "" || measure(trial, fontSize) <= limit) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

export function reflowBlock(
  block: TextBlock,
  newText: string,
  measure: MeasureFn,
): ReflowResult {
  if (!block.reflowable) {
    return { canReflow: false, lines: [], shiftDelta: 0 };
  }

  const fontSize = block.fontSize;
  const lineHeight = block.lineHeight;
  const oldHeight = block.top - block.bottom;
  const firstMax = block.width - block.indent;
  const otherMax = block.width;

  const words = newText.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) {
    return { canReflow: true, lines: [], shiftDelta: -oldHeight };
  }

  const wrapped = wrap(words, firstMax, otherMax, fontSize, measure);
  const ascent = fontSize * 0.8;

  const lines: ReflowLine[] = wrapped.map((text, i) => {
    const y = block.top - i * lineHeight - ascent;
    const w = measure(text, fontSize);
    let x = block.left + (i === 0 ? block.indent : 0);
    if (block.align === "center") x = block.left + (block.width - w) / 2;
    else if (block.align === "right") x = block.left + (block.width - w);
    return { text, x, y, fontSize };
  });

  const newHeight = wrapped.length * lineHeight;
  const shiftDelta = newHeight - oldHeight;
  return { canReflow: true, lines, shiftDelta };
}
