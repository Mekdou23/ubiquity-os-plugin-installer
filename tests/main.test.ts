import { drop } from "@mswjs/data";
import { db } from "./__mocks__/db";
import { server } from "./__mocks__/node";
import usersGet from "./__mocks__/users-get.json";
import { describe, beforeAll, beforeEach, afterAll, afterEach, it, expect } from "@jest/globals";
import YAML from "yaml";
import minimalPredefined from "../static/minimal-predefined.json";
import { ConfigParser } from "../static/scripts/config-parser";
import { getPremadePluginSettings, parsePremadeTemplate, renderPremadeConfigYaml } from "../static/scripts/predefined-configs/template-handler";

const sampleYamlTemplate = `metadata:
  name: "UbiquityOS Standard Config"
  description: "The fully-enabled and battle-tested configuration which we use across all organizations at Ubiquity."
  version: "1.0"

plugins:
  - uses:
      - plugin: ubiquity-os-marketplace/command-start-stop@development
        with:
          reviewDelayTolerance: "3 Days"
          startRequiresWallet: true
`;

beforeAll(() => {
  if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem(key: string) {
          return store.get(key) ?? null;
        },
        setItem(key: string, val: string) {
          store.set(key, val);
        },
        removeItem(key: string) {
          store.delete(key);
        },
        clear() {
          store.clear();
        },
      },
      configurable: true,
    });
  }
  server.listen();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Premade config templates and non-expanded plugin handling", () => {
  beforeEach(() => {
    drop(db);
    for (const item of usersGet) {
      db.users.create(item);
    }
  });

  it("parses YAML-based premade config templates with metadata and plugins", () => {
    const parsed = parsePremadeTemplate(sampleYamlTemplate);
    expect(parsed.metadata).toEqual({
      name: "UbiquityOS Standard Config",
      description: "The fully-enabled and battle-tested configuration which we use across all organizations at Ubiquity.",
      version: "1.0",
    });
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins[0].uses[0].plugin).toBe("ubiquity-os-marketplace/command-start-stop@development");
  });

  it("strips template metadata when rendering executable repository config YAML", () => {
    const rendered = renderPremadeConfigYaml(sampleYamlTemplate);
    const decoded = YAML.parse(rendered) as Record<string, unknown>;
    expect(decoded.metadata).toBeUndefined();
    expect(Array.isArray(decoded.plugins)).toBe(true);
  });

  it("resolves predefined plugin settings for expanded plugins from premade config", () => {
    const settings = getPremadePluginSettings("command-start-stop", JSON.stringify(minimalPredefined));
    expect(settings).toBeDefined();
    expect(settings?.startRequiresWallet).toBe(true);
    expect(getPremadePluginSettings("non-existent-plugin", sampleYamlTemplate)).toBeUndefined();
  });

  it("stores non-expanded plugin installations without opinionated with defaults", () => {
    const parser = new ConfigParser();
    parser.repoConfig = YAML.stringify({ plugins: [] });
    parser.addPlugin({
      uses: [
        {
          plugin: "https://ubiquity-os-daemon-pricing.ubiquity.workers.dev",
          with: {},
        },
      ],
    });
    const saved = parser.parseConfig(parser.repoConfig);
    expect(saved.plugins).toEqual([
      {
        uses: [
          {
            plugin: "https://ubiquity-os-daemon-pricing.ubiquity.workers.dev",
          },
        ],
      },
    ]);
  });
});
