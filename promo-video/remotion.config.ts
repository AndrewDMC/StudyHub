/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// Il Chrome scaricato da Remotion non parte su questa macchina (spawn UNKNOWN): usa quello di sistema.
Config.setBrowserExecutable(
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
);
