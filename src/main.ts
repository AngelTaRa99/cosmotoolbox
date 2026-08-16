import { tools, getToolById } from "./tools/registry";
import { toolModules, type ToolModule } from "./tools";
import { getIcon } from "./tools/icons";

const homeView = document.getElementById("view-home")!;
const toolView = document.getElementById("view-tool")!;
const toolsGrid = document.getElementById("tools-grid")!;
const toolTitle = document.getElementById("tool-title")!;
const toolBody = document.getElementById("tool-body")!;
const backBtn = document.getElementById("btn-back")!;

let activeModule: ToolModule | null = null;

function renderHome(): void {
  activeModule?.unmount?.();
  activeModule = null;
  toolView.hidden = true;
  homeView.hidden = false;
  toolsGrid.innerHTML = "";

  for (const tool of tools) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "tool-tile";
    tile.innerHTML = `
      <div class="tool-icon">${getIcon(tool.icon)}</div>
      <div class="tool-name">${tool.name}</div>
      <div class="tool-desc">${tool.description}</div>
    `;
    tile.addEventListener("click", () => {
      location.hash = `#/tools/${tool.id}`;
    });
    toolsGrid.appendChild(tile);
  }
}

function renderTool(id: string): void {
  const tool = getToolById(id);
  if (!tool) {
    location.hash = "#/";
    return;
  }

  activeModule?.unmount?.();
  activeModule = null;

  homeView.hidden = true;
  toolView.hidden = false;
  toolTitle.textContent = tool.name;
  toolBody.innerHTML = "";

  const module = toolModules[tool.id];
  if (module) {
    activeModule = module;
    module.mount(toolBody);
  } else {
    const msg = document.createElement("p");
    msg.className = "status-msg error";
    msg.textContent = "Esta herramienta aún no está implementada.";
    toolBody.appendChild(msg);
  }
}

function onHashChange(): void {
  const match = location.hash.match(/^#\/tools\/([\w-]+)$/);
  if (match) {
    renderTool(match[1]);
  } else {
    renderHome();
  }
}

window.addEventListener("hashchange", onHashChange);

backBtn.addEventListener("click", () => {
  location.hash = "#/";
});

onHashChange();
