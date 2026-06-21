export function revealToggleLabel(
  loading: boolean,
  revealed: boolean,
  loadingText: string,
  hideText: string,
  revealText: string,
): string {
  if (loading) {
    return loadingText;
  }
  if (revealed) {
    return hideText;
  }
  return revealText;
}
