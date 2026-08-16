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
};

export function getIcon(name: ToolIcon): string {
  return icons[name];
}
