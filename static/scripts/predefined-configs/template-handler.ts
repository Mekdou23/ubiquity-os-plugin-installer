import YAML from "yaml";
import { AnySchemaObject } from "ajv";
import { CONFIG_FULL_PATH, CONFIG_ORG_REPO } from "@ubiquity-os/plugin-sdk/constants";
import { AuthService } from "../authentication";
import { ManifestRenderer } from "../render-manifest";
import { controlButtons } from "../rendering/control-buttons";
import { parseConfigInputs } from "../rendering/input-parsing";
import { addTrackedEventListener, updateGuiTitle } from "../rendering/utils";
import { Manifest, ManifestPreDecode, Plugin, PluginConfig, PremadeConfigTemplate, PremadeMetadata } from "../../types/plugins";
import { createConfigParamTooltip, createElement, createInputRow } from "../../utils/element-helpers";
import { getManifestCache } from "../../utils/storage";
import { STRINGS } from "../../utils/strings";
import { toastNotification } from "../../utils/toaster";

type TemplateTypes = "minimal" | "full-defaults" | "custom";
declare const MINIMAL_PREDEFINED_CONFIG: string;

const DEFAULT_PREMADE_METADATA: PremadeMetadata = {
  name: "UbiquityOS Standard Config",
  description: "The fully-enabled and battle-tested configuration which we use across all organizations at Ubiquity.",
  version: "1.0",
};

export function parsePremadeTemplate(rawConfig?: string): PremadeConfigTemplate {
  const source = rawConfig ?? (typeof MINIMAL_PREDEFINED_CONFIG !== "undefined" ? MINIMAL_PREDEFINED_CONFIG : "");
  const trimmed = source.trim();
  if (!trimmed) {
    return { metadata: { ...DEFAULT_PREMADE_METADATA }, plugins: [] };
  }
  if (trimmed.startsWith("{")) {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if ("metadata" in obj && "plugins" in obj && Array.isArray(obj.plugins)) {
      const meta = obj.metadata as Partial<PremadeMetadata>;
      return {
        metadata: {
          name: meta.name || DEFAULT_PREMADE_METADATA.name,
          description: meta.description || DEFAULT_PREMADE_METADATA.description,
          version: meta.version || DEFAULT_PREMADE_METADATA.version,
        },
        plugins: obj.plugins as Plugin[],
      };
    }
    const parts = Object.entries(obj).map(([, value]) => {
      return `\n  ${typeof value === "object" && value && "yamlConfig" in value && value.yamlConfig ? String(value.yamlConfig) : ""}`;
    });
    const parsedPlugins = YAML.parse(`plugins:${parts.join("")}`) as PluginConfig | null;
    return {
      metadata: { ...DEFAULT_PREMADE_METADATA },
      plugins: parsedPlugins?.plugins || [],
    };
  }
  const parsedYaml = YAML.parse(trimmed) as Partial<PremadeConfigTemplate> | null;
  const meta = parsedYaml?.metadata;
  return {
    metadata: {
      name: meta?.name || DEFAULT_PREMADE_METADATA.name,
      description: meta?.description || DEFAULT_PREMADE_METADATA.description,
      version: meta?.version || DEFAULT_PREMADE_METADATA.version,
    },
    plugins: Array.isArray(parsedYaml?.plugins) ? parsedYaml.plugins : [],
  };
}

export function renderPremadeConfigYaml(rawConfig?: string): string {
  const template = parsePremadeTemplate(rawConfig);
  return YAML.stringify({ plugins: template.plugins });
}

export function getPremadePluginSettings(pluginIdentifier: string, rawConfig?: string): Record<string, unknown> | undefined {
  const normalizedTarget = pluginIdentifier.trim().toLowerCase();
  if (!normalizedTarget) {
    return undefined;
  }
  try {
    const template = parsePremadeTemplate(rawConfig);
    const matched = template.plugins.find((entry) =>
      entry.uses?.some((useItem) => useItem.plugin.toLowerCase().includes(normalizedTarget))
    );
    return matched?.uses?.[0]?.with;
  } catch {
    return undefined;
  }
}

export async function configTemplateHandler(type: TemplateTypes, renderer: ManifestRenderer) {
  const org = localStorage.getItem("selectedOrg");

  if (!org) {
    throw new Error("No selected org found");
  }

  const octokit = renderer.auth.octokit;
  if (!octokit) {
    throw new Error("Octokit not found");
  }

  const userInstalledConfig = await renderer.configParser.fetchUserInstalledConfig(org, octokit);

  if (userInstalledConfig.length > 12) {
    toastNotification("Configuration File Detected: This will be overwritten if you continue.", { type: "warning", shouldAutoDismiss: true });
  }

  if (type === "minimal") {
    await writeTemplate(renderer, await handleMinimalTemplate(), type, renderer.auth.octokit, org);
  } else if (type === "full-defaults") {
    await handleFullDefaultsTemplate(renderer);
  } else {
    throw new Error("Invalid template type");
  }
}

async function writeTemplate(renderer: ManifestRenderer, config: string, type: TemplateTypes, octokit: AuthService["octokit"], org: string) {
  try {
    renderer.configParser.saveConfig(config);
    toastNotification(`Successfully loaded ${type} template. Do you want to push to GitHub? `, {
      type: "success",
      actionText: "Push to GitHub",
      action: async () => {
        try {
          await renderer.configParser.createOrUpdateFileContents(org, CONFIG_ORG_REPO, CONFIG_FULL_PATH, octokit);
        } catch (error) {
          console.error("Error pushing config to GitHub:", error);
          toastNotification("An error occurred while pushing the configuration to GitHub.", {
            type: "error",
            shouldAutoDismiss: true,
          });
          return;
        }
        toastNotification("Configuration pushed to GitHub successfully.", {
          type: "success",
          shouldAutoDismiss: true,
        });
      },
    });
  } catch (error) {
    toastNotification(STRINGS.FAILED_TO_LOAD_TEMPLATE, { type: "error" });
    throw error;
  }
}

async function handleMinimalTemplate(): Promise<string> {
  try {
    return renderPremadeConfigYaml(MINIMAL_PREDEFINED_CONFIG);
  } catch (error) {
    toastNotification("Failed to fetch minimal predefined config", { type: "error" });
    throw error;
  }
}

async function handleFullDefaultsTemplate(renderer: ManifestRenderer): Promise<string> {
  renderer.configParser.writeBlankConfig();

  const response = await fetch("https://raw.githubusercontent.com/ubiquity/onboard.ubq.fi/development/static/types/default-configuration.yml");

  if (!response.ok) {
    throw new Error("Failed to fetch full defaults template");
  }

  // if there was no required field we would just return the config
  const config = await response.text();

  const manifestCache = getManifestCache();
  const plugins = Object.keys(manifestCache).map((key) => manifestCache[key]);
  const pluginWithDefaults: { name: string; defaults: ManifestPreDecode }[] = [];

  plugins.forEach((plugin) => {
    const {
      manifest: { configuration },
    } = plugin;
    if (!configuration) {
      return;
    }
    pluginWithDefaults.push({
      name: plugin.homepageUrl || plugin.manifest.name,
      defaults: buildDefaultValues(configuration),
    });
  });

  await renderRequiredFields(renderer, pluginWithDefaults).catch((error) => {
    console.error("Error rendering required fields:", error);
    toastNotification("An error occurred while rendering the required fields.", {
      type: "error",
      shouldAutoDismiss: true,
    });
  });

  return config;
}

/**
 * undefined === not a required field, can be omitted
 * null === required field, but no default value
 *
 * for each null value, we need to render an input for that field
 * referencing the plugin name. Expect there to be lots but in reality
 * there are only a few.
 *
 */

async function renderRequiredFields(renderer: ManifestRenderer, plugins: { name: string; defaults: Manifest["configuration"] }[]) {
  const configDefaults: Record<string, { type: string; value: unknown; items: { type: string } | null }> = {};
  const pluginWithDefaults: { name: string; defaults: Manifest["configuration"] }[] = [];
  renderer.manifestGuiBody.innerHTML = null;

  plugins.forEach((plugin) => {
    const { name, defaults } = plugin;
    pluginWithDefaults.push({ name, defaults });
  });

  for (const plugin of pluginWithDefaults) {
    const { defaults } = plugin;

    for (const [key, prop] of Object.entries(defaults || {})) {
      if (prop === null) {
        const row = createElement("tr", { className: "config-row" });
        const headerCell = createElement("td", { className: "table-data-header" });
        headerCell.textContent = key.replace(/([A-Z])/g, " $1");
        createConfigParamTooltip(headerCell, prop);
        row.appendChild(headerCell);
        createInputRow(key, prop, configDefaults, undefined, undefined, true);
      }
    }
  }

  updateGuiTitle("Fill in required fields");
  controlButtons({ hide: false });

  const resetToDefaultButton = document.getElementById("reset-to-default") as HTMLButtonElement;
  if (!resetToDefaultButton) {
    throw new Error("Reset to default button not found");
  }

  resetToDefaultButton.addEventListener("click", () => {
    renderRequiredFields(renderer, plugins).catch((error) => {
      console.error("Error rendering required fields:", error);
      toastNotification("An error occurred while rendering the required fields.", {
        type: "error",
        shouldAutoDismiss: true,
      });
    });
  });

  const add = document.getElementById("add") as HTMLButtonElement;
  const remove = document.getElementById("remove") as HTMLButtonElement;
  if (!add || !remove) {
    throw new Error("Add or remove button not found");
  }
  remove.classList.add("disabled");

  addTrackedEventListener(add, "click", () => {
    writeRequiredConfig(plugins, renderer);
  });

  renderer.manifestGui?.classList.add("plugin-editor");
  renderer.manifestGui?.classList.add("rendered");
}

function writeRequiredConfig(plugins: { name: string; defaults: Manifest["configuration"] }[], renderer: ManifestRenderer) {
  const configInputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".config-input");
  const newConfig = parseConfigInputs(configInputs, {} as Manifest, plugins);

  const manifestCache = getManifestCache();
  const pluginNames = Object.values(manifestCache).map((plugin) => plugin.homepageUrl || plugin.manifest.name);

  const pluginArr: Plugin[] = [];

  for (const [name, config] of Object.entries(newConfig.config)) {
    // this relies on the worker deployment url containing the plugin name
    const pluginUrl = pluginNames.find((url) => {
      return url.includes(name);
    });

    if (!pluginUrl) {
      toastNotification(`No plugin URL found for ${name}.`, {
        type: "error",
        shouldAutoDismiss: true,
      });

      return;
    }

    const plugin: Plugin = {
      uses: [
        {
          plugin: pluginUrl,
          with: config as Record<string, unknown>,
        },
      ],
    };

    pluginArr.push(plugin);
  }

  const pluginConfig: PluginConfig = {
    plugins: pluginArr,
  };

  const org = localStorage.getItem("selectedOrg");
  if (!org) {
    throw new Error("No selected org found");
  }

  writeTemplate(renderer, YAML.stringify(pluginConfig), "full-defaults", renderer.auth.octokit, localStorage.getItem("selectedOrg") || "").catch((error) => {
    console.error("Error writing template:", error);
    toastNotification("An error occurred while writing the template.", {
      type: "error",
      shouldAutoDismiss: true,
    });
  });
}

function buildDefaultValues<T>(schema: AnySchemaObject): T {
  const defaults: Partial<T> = {};
  const requiredProps = schema.required || [];

  for (const key of Object.keys(schema.properties)) {
    if (Reflect.has(schema.properties, key)) {
      const hasDefault = "default" in schema.properties[key];
      const value = schema.properties[key].default;

      const _key = key as keyof T;

      if (hasDefault && value) {
        defaults[_key] = value;
      } else if (requiredProps.includes(_key)) {
        defaults[_key] = null as unknown as T[keyof T];
      } else {
        defaults[_key] = undefined;
      }
    }
  }

  return defaults as T;
}
