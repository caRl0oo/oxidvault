export function syncButtonStatusText(
  syncError: string | null,
  syncing: boolean,
  syncMessage: string | null,
  syncingLabel: string,
): string | null {
  if (syncError) {
    return syncError;
  }
  if (syncing) {
    return syncingLabel;
  }
  return syncMessage;
}
