// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

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
