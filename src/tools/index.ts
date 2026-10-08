export interface ToolModule {
  mount(container: HTMLElement): void;
  unmount?(): void;
}

import { photoBackground } from "./photo-background";
import { pdfEditor } from "./pdf-editor";

export const toolModules: Record<string, ToolModule> = {
  "foto-corrector": photoBackground,
  "pdf-editor": pdfEditor,
};
