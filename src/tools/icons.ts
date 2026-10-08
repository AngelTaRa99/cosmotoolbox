import type { ToolIcon } from "./registry";

const icons: Record<ToolIcon, string> = {
  photo: `
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="8" y="14" width="48" height="36" rx="6"/>
      <circle cx="24" cy="29" r="5"/>
      <path d="M12 46 L26 32 L34 40 L42 32 L56 46"/>
      <path d="M44 12 l1.6 3.4 L49 17 l-3.4 1.6 L44 22 l-1.6-3.4 L39 17 l3.4-1.6 z"/>
      <path d="M54 8 l1.2 2.6 2.6 1.2-2.6 1.2L54 15.6l-1.2-2.6-2.6-1.2 2.6-1.2z"/>
    </svg>`,
  pdf: `
  <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M14 8 h24 l12 12 v36 a2 2 0 0 1 -2 2 H14 a2 2 0 0 1 -2 -2 V10 a2 2 0 0 1 2 -2 z"/>
    <path d="M38 8 v12 h12"/>
    <path d="M22 34 h16 M22 42 h16 M22 50 h10"/>
  </svg>`,
};

export function getIcon(name: ToolIcon): string {
  return icons[name];
}
