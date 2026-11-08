import { Manifest } from "@ubiquity-os/ubiquity-os-kernel";

type PremadeMetadata = {
  name: string;
  description: string;
  version: string;
};

type PremadeConfigTemplate = {
  metadata: PremadeMetadata;
  plugins: Plugin[];
};

type PluginConfig = {
  plugins: Plugin[];
};

interface Plugin {
  uses: Uses[];
  skipBotEvents?: boolean;
}

interface Uses {
  plugin: string;
  with?: Record<string, unknown>;
}

interface ManifestPreDecode {
  manifest: Manifest;
  homepageUrl?: string | null;
  error?: string;
  readme?: string;
}

type ManifestCache = Record<string, ManifestPreDecode>;

export { ManifestCache, PluginConfig, Plugin, Uses, ManifestPreDecode, Manifest, PremadeMetadata, PremadeConfigTemplate };
