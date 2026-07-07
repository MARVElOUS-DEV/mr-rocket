import packageJson from "../package.json";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const APP_NAME = packageJson.name;
export const APP_VERSION = packageJson.version;

if (!SEMVER_PATTERN.test(APP_VERSION)) {
  throw new Error(`Invalid ${APP_NAME} version: ${APP_VERSION}`);
}

export function formatVersion(): string {
  return `${APP_NAME} ${APP_VERSION}`;
}
