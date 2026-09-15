// Typed re-export of the pinned Irodori artifacts shared with the launcher.
export {
  IRODORI_ASSET_MEMBERS,
  IRODORI_ASSETS_ARCHIVE,
  IRODORI_ENGINE_ARCHIVE,
  IRODORI_ENGINE_MARKER,
  IRODORI_ENGINE_MEMBERS,
  IRODORI_ENGINE_VERSION,
  IRODORI_MODEL_FILE,
  IRODORI_MODEL_MARKER,
  IRODORI_MODEL_NAME,
  IRODORI_MODEL_REPOSITORY,
  IRODORI_MODEL_REVISION,
  irodoriEngineInstalled,
  irodoriInstalledModel,
  irodoriInstallPaths,
} from "@/shared/irodori-release.mjs";

export type IrodoriArtifact = {
  id: "engine" | "assets" | "model";
  url: string;
  sizeBytes: number;
  sha256: string;
  installedBytes: number;
};
