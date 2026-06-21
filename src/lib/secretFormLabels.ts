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
