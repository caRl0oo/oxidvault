// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

export function secretFormSubmitLabel(
  loadingSecrets: boolean,
  loading: boolean,
  isEdit: boolean,
  translate: (key: string) => string,
): string {
  if (loadingSecrets) {
    return translate("secretForm.loadingSecrets");
  }
  if (loading) {
    return isEdit
      ? translate("secretForm.encryptUpdating")
      : translate("secretForm.encryptSaving");
  }
  return translate("common.save");
}
