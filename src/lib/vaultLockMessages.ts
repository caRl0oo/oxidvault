import type { TFunction } from "i18next";

export function vaultLockMessage(
  reason: string,
  autoLockSeconds: number,
  t: TFunction,
): string | undefined {
  if (reason === "idle") {
    return t("app.autoLocked", { seconds: autoLockSeconds });
  }
  if (reason === "minimize") {
    return t("app.lockedOnMinimize");
  }
  return undefined;
}

export function resolveIdleLockSeconds(
  eventSeconds: number | undefined,
  configSeconds: number | undefined,
  fallback = 120,
): number {
  if (eventSeconds !== undefined && eventSeconds > 0) {
    return eventSeconds;
  }
  if (configSeconds !== undefined && configSeconds > 0) {
    return configSeconds;
  }
  return fallback;
}
