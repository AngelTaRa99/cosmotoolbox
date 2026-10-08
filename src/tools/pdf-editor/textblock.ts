// src/tools/pdf-editor/textblock.ts
export interface TextRun {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fontName: string;
}

export interface TextLine {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fontName: string;
  runs: TextRun[];
}

export interface TextBlock {
  lines: TextLine[];
  left: number;
  top: number;
  bottom: number;
  width: number;
  fontSize: number;
  lineHeight: number;
  indent: number;
  align: "left" | "center" | "right";
  reflowable: boolean;
  page: number;
}

export interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

interface PlacedItem {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fontName: string;
}

function toPlaced(raw: RawTextItem): PlacedItem | null {
  const text = raw.str;
  if (text.trim().length === 0) return null;
  const x = raw.transform[4] ?? 0;
  const y = raw.transform[5] ?? 0;
  const scale = Math.abs(raw.transform[3] ?? 0);
  const fontSize = raw.height > 0 ? raw.height : scale || 12;
  return { text, x, y, width: raw.width, fontSize, fontName: raw.fontName };
}

function clusterByBaseline(items: PlacedItem[]): PlacedItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PlacedItem[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last) {
      const ref = last[0];
      const tol = Math.max(ref.fontSize, it.fontSize) * 0.4;
      if (Math.abs(ref.y - it.y) <= tol) {
        last.push(it);
        continue;
      }
    }
    lines.push([it]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

function buildLine(members: PlacedItem[]): TextLine {
  const runs: TextRun[] = members.map((m) => ({
    text: m.text,
    x: m.x,
    y: m.y,
    width: m.width,
    fontSize: m.fontSize,
    fontName: m.fontName,
  }));
  const first = members[0];
  const text = members.map((m) => m.text).join("");
  const left = Math.min(...members.map((m) => m.x));
  const right = Math.max(...members.map((m) => m.x + m.width));
  return {
    text,
    x: left,
    y: first.y,
    width: right - left,
    fontSize: first.fontSize,
    fontName: first.fontName,
    runs,
  };
}

function groupLinesToBlocks(
  lines: TextLine[],
  page: number,
): TextBlock[] {
  if (lines.length === 0) return [];
  const blocks: TextLine[][] = [];
  let current: TextLine[] = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const prev = current[current.length - 1];
    const line = lines[i];
    const gap = prev.y - line.y;
    const typical = (prev.fontSize + line.fontSize) / 2;
    const closeVertically = gap <= typical * 2.5 && gap >= -typical * 0.5;
    if (closeVertically) current.push(line);
    else {
      blocks.push(current);
      current = [line];
    }
  }
  blocks.push(current);

  return blocks.map((group) => {
    const left = Math.min(...group.map((l) => l.x));
    const right = Math.max(...group.map((l) => l.x + l.width));
    const top = Math.max(...group.map((l) => l.y));
    const minBottom = Math.min(...group.map((l) => l.y));
    const fontSize = group[0].fontSize;
    const bottom = minBottom - fontSize * 0.25;
    const lineHeight =
      group.length > 1 ? (group[0].y - group[group.length - 1].y) / (group.length - 1) : fontSize * 1.2;
    const leftSpread = Math.max(...group.map((l) => l.x)) - left;
    const indent = group.length > 1 ? Math.max(0, group[0].x - Math.min(...group.slice(1).map((l) => l.x))) : 0;
    return {
      lines: group,
      left,
      top,
      bottom,
      width: right - left,
      fontSize,
      lineHeight,
      indent,
      align: "left" as const,
      reflowable: leftSpread <= 12,
      page,
    };
  });
}

export function groupTextItems(items: RawTextItem[], page: number): TextBlock[] {
  const placed: PlacedItem[] = [];
  for (const raw of items) {
    const p = toPlaced(raw);
    if (p) placed.push(p);
  }
  const lines = clusterByBaseline(placed).map(buildLine);
  return groupLinesToBlocks(lines, page);
}
