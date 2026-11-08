import { Manifest } from "../types/plugins";
import MarkdownIt from "markdown-it";
const md = new MarkdownIt();

const CONFIG_INPUT_STR = "config-input";

export const manifestGuiBody = typeof document !== "undefined" ? document.getElementById("manifest-gui-body") : null;

export function createElement<TK extends keyof HTMLElementTagNameMap>(
  tagName: TK,
  attributes: { [key: string]: string | boolean | null }
): HTMLElementTagNameMap[TK] {
  const element = document.createElement(tagName);

  Object.keys(attributes).forEach((key) => {
    if (key === "textContent") {
      element.textContent = attributes[key] as string;
    } else if (key in element) {
      (element as Record<string, string | boolean | null>)[key] = attributes[key];
    } else {
      element.setAttribute(key, `${attributes[key]}`);
    }
  });

  return element;
}
export function createInputRow(
  key: string,
  prop: Manifest["configuration"],
  configDefaults: Record<string, { type: string; value: unknown; items: { type: string } | null }>,
  desc?: string,
  examples?: string[],
  required = false
): void {
  const row = document.createElement("tr");
  const headerCell = document.createElement("td");
  headerCell.className = "table-data-header";
  headerCell.textContent = key.replace(/([A-Z])/g, " $1");

  if (prop && !prop.description && desc) {
    prop.description = desc;
  }

  if (prop && !prop.examples && examples) {
    prop.examples = examples;
  }

  createConfigParamTooltip(headerCell, prop);
  row.appendChild(headerCell);

  const valueCell = document.createElement("td");
  valueCell.className = "table-data-value";
  valueCell.ariaRequired = `${required}`;

  const input = createInput(key, prop?.default, prop?.type);
  valueCell.appendChild(input);

  row.appendChild(valueCell);
  manifestGuiBody?.appendChild(row);

  configDefaults[key] = {
    type: prop?.type,
    value: prop?.default,
    items: prop?.items ? { type: prop?.items.type } : null,
  };
}
export function createInput(key: string, defaultValue: unknown, prop: string): HTMLElement {
  if (!key) {
    throw new Error("Input name is required");
  }

  let ele: HTMLElement | null = null;

  if (prop === "object" || typeof defaultValue === "object") {
    ele = createTextareaInput(key, defaultValue as object, prop);
  } else if (prop === "boolean") {
    ele = createBooleanInput(key, defaultValue as boolean);
  } else if (prop === "number" || prop === "integer") {
    ele = createStringInput(key, defaultValue as string, "number");
  } else {
    ele = createStringInput(key, defaultValue ? (defaultValue as string) : "", prop ?? typeof defaultValue);
  }

  return ele;
}
export function createStringInput(key: string, defaultValue: string, dataType: string): HTMLElement {
  return createElement("input", {
    type: "text",
    id: key,
    name: key,
    "data-config-key": key,
    "data-type": dataType,
    class: CONFIG_INPUT_STR,
    value: defaultValue,
  });
}
export function createBooleanInput(key: string, defaultValue: boolean | unknown): HTMLElement {
  return createElement("input", {
    type: "checkbox",
    id: key,
    name: key,
    "data-config-key": key,
    "data-type": "boolean",
    class: CONFIG_INPUT_STR,
    checked: defaultValue as boolean,
  });
}
export function createTextareaInput(key: string, defaultValue: object | unknown, dataType: string): HTMLElement {
  let text = "";

  if (typeof defaultValue === "object") {
    text = JSON.stringify(defaultValue, null, 2);
  } else {
    text = defaultValue ? (defaultValue as string) : "";
  }

  const textContent = dataType === undefined ? "" : text;

  return createElement("textarea", {
    id: key,
    name: key,
    "data-config-key": key,
    "data-type": dataType,
    class: CONFIG_INPUT_STR,
    rows: "5",
    cols: "50",
    textContent,
  });
}

function createTooltipText(desc: string, examples: (string | number | object)[]) {
  const tooltipText = createElement("span", { class: "tooltiptext" });
  tooltipText.innerHTML = md.renderInline(desc);

  if (!examples || typeof examples === "string") {
    return tooltipText;
  }

  if (examples.length) {
    let str;
    try {
      str = `Examples: ${examples
        .map((ex) => {
          if (!ex) {
            return "";
          }
          if (typeof ex === "object") {
            return JSON.stringify(ex);
          }

          if (typeof ex === "number") {
            ex = ex.toString();
          }

          if (ex.includes("[") || ex.includes("{")) {
            return ex;
          }

          return `${ex}`;
        })
        .join(", ")}`;
    } catch (er) {
      console.log(`Error parsing examples: `, examples);
      console.error(er);
    }

    if (!str) {
      return tooltipText;
    }

    const exampleElem = createElement("p", { textContent: str });
    tooltipText.appendChild(exampleElem);
  }

  return tooltipText;
}

export function createConfigParamTooltip(headerCell: HTMLElement, prop: Manifest["configuration"]): void {
  if (!prop || !prop.description) {
    return;
  }

  const tooltip = createElement("span", { class: "tooltip", textContent: "?", id: prop?.id });
  const tooltipText = createTooltipText(prop?.description, prop?.examples || []);

  tooltip.appendChild(tooltipText);
  headerCell.appendChild(tooltip);

  tooltip.addEventListener("mouseenter", () => {
    tooltipText.style.visibility = "visible";
    tooltipText.style.opacity = "1";
  });

  tooltip.addEventListener("mouseleave", () => {
    tooltipText.style.visibility = "hidden";
    tooltipText.style.opacity = "0";
  });
}
