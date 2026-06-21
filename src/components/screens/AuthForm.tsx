import { useTranslation } from "react-i18next";
import { AppLogo } from "@/components/AppLogo";
import { MasterPasswordInput, evaluateMasterPassword } from "@/components/MasterPasswordInput";

interface AuthFormProps {
  readonly titleKey: string;
  readonly descriptionKey?: string;
  readonly subtitle?: string;
  readonly password: string;
  readonly onPasswordChange: (v: string) => void;
  readonly vaultName?: string;
  readonly onVaultNameChange?: (v: string) => void;
  readonly enforceMasterPolicy?: boolean;
  readonly error: string | null;
  readonly loading: boolean;
  readonly submitLabelKey: string;
  readonly onSubmit: () => void;
  readonly onBack?: () => void;
  readonly onSwitchVault?: () => void;
  readonly passwordRef: React.RefObject<HTMLInputElement | null>;
}

export function AuthForm({
  titleKey,
  descriptionKey,
  subtitle,
  password,
  onPasswordChange,
  vaultName,
  onVaultNameChange,
  enforceMasterPolicy,
  error,
  loading,
  submitLabelKey,
  onSubmit,
  onBack,
  onSwitchVault,
  passwordRef,
}: Readonly<AuthFormProps>) {
  const { t } = useTranslation();
  const policyValid = enforceMasterPolicy
    ? evaluateMasterPassword(password).valid
    : password.length > 0;
  const canSubmit = !loading && policyValid;

  return (
    <section className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center space-y-3 text-center">
          <AppLogo size="md" />
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">{t(titleKey)}</h1>
            {descriptionKey ? <p className="text-sm text-vault-muted">{t(descriptionKey)}</p> : null}
            {subtitle ? (
              <p className="truncate font-mono text-[11px] text-vault-muted">{subtitle}</p>
            ) : null}
          </div>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {vaultName !== undefined && onVaultNameChange ? (
            <input
              type="text"
              value={vaultName}
              onChange={(e) => onVaultNameChange(e.target.value)}
              placeholder={t("auth.vaultNamePlaceholder")}
              className="w-full rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm placeholder:text-vault-muted focus:border-vault-accent"
            />
          ) : null}
          {enforceMasterPolicy ? (
            <MasterPasswordInput
              value={password}
              onChange={onPasswordChange}
              inputRef={passwordRef}
            />
          ) : (
            <input
              ref={passwordRef}
              type="password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder={t("auth.masterPasswordPlaceholder")}
              autoComplete="current-password"
              className="w-full rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm placeholder:text-vault-muted focus:border-vault-accent"
            />
          )}
          {error ? <p className="font-mono text-xs text-vault-danger">{error}</p> : null}
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded bg-vault-accent py-2 text-sm font-medium text-white hover:bg-vault-accent-hover disabled:opacity-50"
          >
            {loading ? t("common.pleaseWait") : t(submitLabelKey)}
          </button>
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="w-full py-1 text-xs text-vault-muted hover:text-vault-text"
            >
              {t("auth.back")}
            </button>
          ) : null}
          {onSwitchVault ? (
            <button
              type="button"
              onClick={onSwitchVault}
              disabled={loading}
              className="w-full py-1 text-xs text-vault-muted/80 hover:text-vault-muted disabled:opacity-50"
            >
              {t("auth.switchVault")}
            </button>
          ) : null}
        </form>
      </div>
    </section>
  );
}
