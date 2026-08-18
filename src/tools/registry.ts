export type ToolIcon = "photo";

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  icon: ToolIcon;
}

export const tools: ToolDefinition[] = [
  {
    id: "foto-corrector",
    name: "Corrector de fotos",
    description: "Elimina el fondo de una imagen con IA local",
    icon: "photo",
  },
];

export function getToolById(id: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.id === id);
}
