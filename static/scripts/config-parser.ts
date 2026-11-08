import YAML from "yaml";
import { Plugin, PluginConfig } from "../types/plugins";
import { Octokit } from "@octokit/rest";
import { toastNotification } from "../utils/toaster";
import { CONFIG_FULL_PATH, CONFIG_ORG_REPO } from "@ubiquity-os/plugin-sdk/constants";

/**
 * Responsible for fetching, parsing, and updating the user's installed plugin configurations.
 *
 * - `configRepoExistenceCheck` checks if the user has a config repo and creates one if not
 * - `repoFileExistenceCheck` checks if the user has a config file and creates one if not
 * - `fetchUserInstalledConfig` fetches the user's installed config from the config repo
 */
export class ConfigParser {
  repoConfig: string | null = null;
  repoConfigSha: string | null = null;
  newConfigYml: string | null = null;

  async configRepoExistenceCheck(org: string, repo: string, octokit: Octokit) {
    if (!org || !repo) {
      throw new Error("Organization or repo name not provided");
    }

    let exists;

    try {
      await octokit.repos.get({
        owner: org,
        repo,
      });
      exists = true;
    } catch (error) {
      console.log(`${repo} does not exist in ${org}`, error);
      exists = false;
    }

    if (!exists) {
      try {
        await octokit.repos.createInOrg({
          name: repo,
          description: "UbiquityOS Configuration Repo",
          org,
        });

        toastNotification("We noticed you don't have a '.ubiquity-os' config repo, so we created one for you.", { type: "success" });
      } catch (er) {
        if (er instanceof Error && er.message.includes("name already exists on this account")) {
          // https://github.com/ubiquity-os/ubiquity-os-plugin-installer/issues/40
          console.info(`Config repo could not be found but failed to create because it already exists:`, er);
          exists = true;
        } else {
          console.log(er);
          throw new Error("Config repo creation failed");
        }
      }
    }

    return exists;
  }

  async repoFileExistenceCheck(org: string, octokit: Octokit, repo: string, path: string) {
    try {
      const { data } = await octokit.repos.getContent({
        owner: org,
        repo,
        path,
      });

      return data;
    } catch (error) {
      console.error(error);
    }

    return null;
  }

  async fetchUserInstalledConfig(org: string, octokit: Octokit, repo = CONFIG_ORG_REPO, path = CONFIG_FULL_PATH) {
    if (org === repo) {
      repo = CONFIG_ORG_REPO;
    }

    if (repo === CONFIG_ORG_REPO) {
      await this.configRepoExistenceCheck(org, repo, octokit);
    }

    let existingConfig = await this.repoFileExistenceCheck(org, octokit, repo, path);

    if (!existingConfig) {
      try {
        this.newConfigYml = YAML.stringify({ plugins: [] });
        await octokit.repos.createOrUpdateFileContents({
          owner: org,
          repo,
          path,
          message: `chore: creating config`,
          content: btoa(this.newConfigYml),
        });

        toastNotification(`We couldn't locate your config file, so we created an empty one for you.`, { type: "success" });

        existingConfig = await this.repoFileExistenceCheck(org, octokit, repo, path);
      } catch (er) {
        console.log(er);
        throw new Error("Config file creation failed");
      }
    }

    if (existingConfig && "content" in existingConfig) {
      this.repoConfigSha = existingConfig.sha;
      this.repoConfig = atob(existingConfig.content);
    } else {
      throw new Error("No existing config found");
    }

    return this.repoConfig;
  }

  parseConfig(config?: string | null): PluginConfig {
    if (config && typeof config === "string" && config.trim() !== "") {
      return YAML.parse(config);
    } else {
      return YAML.parse(this.loadConfig());
    }
  }

  async updateConfig(org: string, octokit: Octokit, repo = CONFIG_ORG_REPO, path = CONFIG_FULL_PATH) {
    return this.createOrUpdateFileContents(org, repo, path, octokit);
  }

  async createOrUpdateFileContents(org: string, repo: string, path: string, octokit: Octokit | null) {
    if (!octokit) {
      throw new Error("Failed to create or update file contents: Octokit not found");
    }

    if (org === repo) {
      repo = CONFIG_ORG_REPO;
    }

    const recentSha = await octokit.repos.getContent({
      owner: org,
      repo: repo,
      path,
    });

    const sha = "sha" in recentSha.data ? recentSha.data.sha : null;

    if (!sha) {
      throw new Error("No sha found");
    }

    if (!this.newConfigYml) {
      throw new Error("No content to push");
    }

    this.repoConfig = this.newConfigYml;

    return octokit.repos.createOrUpdateFileContents({
      owner: org,
      repo: repo,
      path,
      message: `chore(PluginInstallerUI): updating config`,
      content: btoa(this.newConfigYml),
      sha,
    });
  }

  addPlugin(plugin: Plugin) {
    const parsedConfig = this.parseConfig(this.repoConfig);
    parsedConfig.plugins ??= [];

    const withSettings = plugin.uses[0].with;
    const hasWithSettings = Boolean(withSettings && Object.keys(withSettings).length > 0);
    const normalizedUse = hasWithSettings ? { plugin: plugin.uses[0].plugin, with: withSettings } : { plugin: plugin.uses[0].plugin };
    const normalizedPlugin: Plugin = { ...plugin, uses: [normalizedUse] };

    const existingPlugin = parsedConfig.plugins.find((p) => p.uses[0].plugin === plugin.uses[0].plugin);
    if (existingPlugin) {
      existingPlugin.uses[0] = normalizedUse;
    } else {
      parsedConfig.plugins.push(normalizedPlugin);
    }

    this.newConfigYml = YAML.stringify(parsedConfig);
    this.repoConfig = this.newConfigYml;
    this.saveConfig();
  }

  removePlugin(plugin: Plugin) {
    const parsedConfig = this.parseConfig(this.repoConfig);
    if (!parsedConfig.plugins) {
      toastNotification("No plugins found in config", { type: "error" });
      return;
    }

    parsedConfig.plugins = parsedConfig.plugins.filter((p: Plugin) => p.uses[0].plugin !== plugin.uses[0].plugin);
    this.newConfigYml = YAML.stringify(parsedConfig);
    this.repoConfig = this.newConfigYml;
    this.saveConfig();
  }

  loadConfig(config?: string) {
    if (config) {
      this.saveConfig(config);
    }

    if (!this.newConfigYml) {
      this.newConfigYml = localStorage.getItem("config") as string;
    }

    if (!this.newConfigYml) {
      this.writeBlankConfig();
    }

    if (!this.repoConfig && this.newConfigYml) {
      this.repoConfig = YAML.parse(this.newConfigYml);
    }

    return this.newConfigYml;
  }

  saveConfig(config?: string) {
    if (config) {
      this.newConfigYml = config;
    }
    if (this.newConfigYml) {
      localStorage.setItem("config", this.newConfigYml);
    }
  }

  writeBlankConfig() {
    this.newConfigYml = YAML.stringify({ plugins: [] });
    this.saveConfig();
  }
}
