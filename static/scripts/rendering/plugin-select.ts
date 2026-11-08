import { Plugin } from "../../types/plugins";
import { createElement } from "../../utils/element-helpers";
import { getManifestCache } from "../../utils/storage";
import { STRINGS } from "../../utils/strings";
import { getPremadePluginSettings } from "../predefined-configs/template-handler";
import { ManifestRenderer } from "../render-manifest";
import { renderConfigEditor } from "./config-editor";
import { controlButtons } from "./control-buttons";
import { closeAllSelect, updateGuiTitle } from "./utils";

/**
 * Renders a dropdown of plugins taken from the marketplace with an installed indicator.
 * The user can select a plugin and it will render the configuration editor for that plugin.
 */
export function renderPluginSelector(renderer: ManifestRenderer): void {
  renderer.currentStep = "pluginSelector";
  renderer.backButton.style.display = "block";
  renderer.manifestGuiBody.innerHTML = null;
  controlButtons({ hide: true });

  const manifestCache = getManifestCache();
  const pluginNames = Object.keys(manifestCache);

  const pickerRow = createElement("tr", { className: STRINGS.TDV_CENTERED });
  const pickerCell = createElement("td", {
    colSpan: "2",
    className: STRINGS.TDV_CENTERED,
  });

  const userConfig = renderer.configParser.repoConfig;
  let installedPlugins: Plugin[] = [];

  if (userConfig) {
    installedPlugins = renderer.configParser.parseConfig(userConfig)?.plugins || [];
  }

  const customSelect = createElement("div", { class: "custom-select" });

  const selectSelected = createElement("div", {
    class: "select-selected",
    textContent: "Select a plugin",
  });

  const selectItems = createElement("div", {
    class: "select-items select-hide",
  });

  customSelect.appendChild(selectSelected);
  customSelect.appendChild(selectItems);

  pickerCell.appendChild(customSelect);
  pickerRow.appendChild(pickerCell);

  renderer.manifestGuiBody.appendChild(pickerRow);

  pluginNames.forEach((pluginName) => {
    if (!manifestCache[pluginName]?.manifest?.name) {
      return;
    }
    const reg = new RegExp(pluginName, "i");
    const installedPlugin: Plugin | undefined = installedPlugins.find((plugin) => reg.test(plugin.uses[0].plugin));

    const defaultForInstalled = manifestCache[pluginName];
    const optionText = pluginName.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
    const indicator = installedPlugin ? "🟢" : "🔴";

    const optionDiv = createElement("div", { class: "select-option" });
    const textSpan = createElement("span", { textContent: optionText });
    const indicatorSpan = createElement("span", { textContent: indicator });

    optionDiv.appendChild(textSpan);
    optionDiv.appendChild(indicatorSpan);

    // if there is no `homepage_url` disable the plugin option
    if (!manifestCache[pluginName].homepageUrl) {
      console.log("No homepage url found for", {
        pluginName,
        manifest: manifestCache[pluginName].manifest,
      });
      optionDiv.style.pointerEvents = "none";
      optionDiv.style.opacity = "0.5";
    } else {
      optionDiv.addEventListener("click", () => {
        selectSelected.textContent = optionText;
        closeAllSelect();
        localStorage.setItem("selectedPluginManifest", JSON.stringify(defaultForInstalled));
        const expandedConfig = installedPlugin?.uses[0].with ?? getPremadePluginSettings(pluginName);
        renderConfigEditor(renderer, defaultForInstalled.manifest, expandedConfig);
      });
    }

    selectItems.appendChild(optionDiv);
  });

  selectSelected.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllSelect();
    selectItems.classList.toggle(STRINGS.SELECT_HIDE);
    selectSelected.classList.toggle(STRINGS.SELECT_ARROW_ACTIVE);
  });

  updateGuiTitle(`Select a Plugin`);
}
