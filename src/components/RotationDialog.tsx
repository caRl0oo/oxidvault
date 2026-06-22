import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MasterPasswordInput } from "@/components/MasterPasswordInput";
import { formatVaultError } from "@/lib/errors";
import { runAsync } from "@/lib/runAsync";
import { INPUT_FIELD_CLASS } from "@/lib/uiClasses";
import { getResolvedConfig, reencryptVault } from "@/lib/ipc";
import { evaluateMasterPasswordWithMin, MIN_MASTER_PASSWORD_LENGTH } from "@/lib/passwordPolicy";

interface RotationDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}

export function RotationDialog({ open, onClose, onSuccess }: Readonly<RotationDialogProps>) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const programmaticCloseRef = useRef(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [minLength, setMinLength] = useState(MIN_MASTER_PASSWORD_LENGTH);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newPolicy = useMemo(
    () => evaluateMasterPasswordWithMin(newPassword, minLength),
    [newPassword, minLength],
  );

  const resetForm = useCallback(() => {
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    resetForm();

    const loadMinLength = async () => {
      try {
        const config = await getResolvedConfig();
        setMinLength(config.minMasterPasswordLen.value);
      } catch {
        setMinLength(MIN_MASTER_PASSWORD_LENGTH);
      }
    };

    loadMinLength();
  }, [open, resetForm]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
      return;
    }

    if (!open && dialog.open) {
      programmaticCloseRef.current = true;
      dialog.close();
    }
  }, [open]);

  const handleBackdropClose = () => {
    if (loading) {
      return;
    }
    dialogRef.current?.close();
  };

  const handleDialogClose = () => {
    if (programmaticCloseRef.current) {
      programmaticCloseRef.current = false;
      return;
    }
    onClose();
  };

  const canSubmit =
    oldPassword.length > 0 &&
    newPolicy.valid &&
    newPassword === confirmPassword &&
    oldPassword !== newPassword &&
    !loading;

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await reencryptVault(oldPassword, newPassword);
      onSuccess();
      onClose();
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return null;
  }

  const inputClass = INPUT_FIELD_CLASS;

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-[60] m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-vault-overlay p-4 backdrop-blur-sm open:flex"
      onCancel={(event) => {
        if (loading) {
          event.preventDefault();
        }
      }}
      onClose={handleDialogClose}
      aria-labelledby="rotation-dialog-title"
    >
      <button
        type="button"
        aria-label={t("common.closeDialog")}
        className="absolute inset-0 cursor-default bg-transparent"
        onClick={handleBackdropClose}
        disabled={loading}
        tabIndex={-1}
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-lg border border-vault-border bg-vault-surface shadow-xl">
        <header className="border-b border-vault-border px-5 py-4">
          <h2 id="rotation-dialog-title" className="font-mono text-sm font-semibold">
            {t("rotation.title")}
          </h2>
          <p className="mt-1 text-xs text-vault-muted">{t("rotation.subtitle")}</p>
        </header>

        {loading ? (
          <div className="space-y-3 px-5 py-8 text-center">
            <div
              className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-vault-border border-t-vault-accent"
              aria-hidden="true"
            />
            <p className="font-mono text-xs text-vault-muted">{t("rotation.loading")}</p>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4">
            <div>
              <label
                htmlFor="rotation-old-password"
                className="mb-1 block font-mono text-[11px] text-vault-muted"
              >
                {t("rotation.current_password")}
              </label>
              <input
                id="rotation-old-password"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                autoComplete="current-password"
                className={inputClass}
              />
            </div>

            <div>
              <label
                htmlFor="rotation-new-password"
                className="mb-1 block font-mono text-[11px] text-vault-muted"
              >
                {t("rotation.new_password")}
              </label>
              <MasterPasswordInput
                id="rotation-new-password"
                value={newPassword}
                onChange={setNewPassword}
                minLength={minLength}
                placeholder={t("rotation.new_password_placeholder")}
              />
            </div>

            <div>
              <label
                htmlFor="rotation-confirm-password"
                className="mb-1 block font-mono text-[11px] text-vault-muted"
              >
                {t("rotation.confirm_password")}
              </label>
              <input
                id="rotation-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className={inputClass}
              />
              {confirmPassword.length > 0 && newPassword !== confirmPassword ? (
                <p className="mt-1 font-mono text-[11px] text-vault-danger">
                  {t("rotation.password_mismatch")}
                </p>
              ) : null}
            </div>

            {error ? <p className="font-mono text-xs text-vault-danger">{error}</p> : null}
          </div>
        )}

        {loading ? null : (
          <footer className="flex justify-end gap-2 border-t border-vault-border px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-vault-border px-3 py-1.5 font-mono text-xs text-vault-muted hover:text-vault-text"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => runAsync(handleSubmit)}
              className="rounded bg-vault-accent px-3 py-1.5 font-mono text-xs text-vault-on-accent hover:bg-vault-accent-hover disabled:opacity-50"
            >
              {t("rotation.submit")}
            </button>
          </footer>
        )}
      </div>
    </dialog>
  );
}
