export interface ToolModule {
  mount(container: HTMLElement): void;
  unmount?(): void;
}

import { photoBackground } from "./photo-background";

export const toolModules: Record<string, ToolModule> = {
  "foto-corrector": photoBackground,
};
