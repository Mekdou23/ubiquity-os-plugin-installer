import YAML from "yaml";
import { Plugin, PluginConfig, Manifest } from "../types/plugins";
import { getManifestCache } from "../utils/storage";
import { toastNotification } from "../utils/toaster";
import { STRINGS } from "../utils/strings";

export class ConfigParser {
  repoConfig: string;

  constructor() {
    this.repoConfig = "";
  }

  saveConfig(config: string) {
    this.repoConfig = config;
  }

  writeBlankConfig() {
    this.repoConfig = YAML.stringify({ plugins: [] });
  }

  parseConfig(config: string): PluginConfig {
    const parsed = YAML.parse(config) as PluginConfig | null;
    if (!parsed || !Array.isArray(parsed.plugins)) {
      return { plugins: [] };
    }

    const cleanedPlugins = parsed.plugins.map((plugin) => {
      if (!plugin.uses || !Array.isArray(plugin.uses)) {
        return plugin;
      }

      const cleanedUses = plugin.uses.map((use) => {
        const cleanedUse = { ...use };
        if (cleanedUse.with && Object.keys(cleanedUse.with).length === 0) {
          delete cleanedUse.with;
        }
        return cleanedUse;
      });

      return { ...plugin, uses: cleanedUses };
    });

    return { plugins: cleanedPlugins };
  }

  addPlugin(plugin: Plugin) {
    const currentConfig = this.parseConfig(this.repoConfig);
    currentConfig.plugins.push(plugin);
    this.repoConfig = YAML.stringify(currentConfig);
  }

  removePlugin(pluginUrl: string) {
    const currentConfig = this.parseConfig(this.repoConfig);
    currentConfig.plugins = currentConfig.plugins.filter((plugin) => {
      return !plugin.uses?.some((use) => use.plugin === pluginUrl);
    });
    this.repoConfig = YAML.stringify(currentConfig);
  }

  async fetchUserInstalledConfig(org: string, octokit: any) {
    try {
      const response = await octokit.rest.repos.getContent({
        owner: org,
        repo: "ubiquity-os-config",
        path: "config.yml",
      });
      const content = (response.data as any).content;
      if (content) {
        const decoded = Buffer.from(content, "base64").toString("utf-8");
        const parsed = YAML.parse(decoded) as PluginConfig;
        return parsed?.plugins || [];
      }
    } catch (error) {
      // 404 means no config exists yet
    }
    return [];
  }

  async createOrUpdateFileContents(org: string, repo: string, path: string, octokit: any) {
    try {
      const existing = await octokit.rest.repos.getContent({
        owner: org,
        repo,
        path,
      });
      const sha = (existing.data as any).sha;
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: org,
        repo,
        path,
        message: "Update config",
        content: Buffer.from(this.repoConfig).toString("base64"),
        sha,
      });
    } catch (error) {
      // If 404, create new file
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: org,
        repo,
        path,
        message: "Create config",
        content: Buffer.from(this.repoConfig).toString("base64"),
      });
    }
  }
}
