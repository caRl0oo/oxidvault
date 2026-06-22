import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AppLogo } from "@/components/AppLogo";
import { MasterPasswordInput, evaluateMasterPassword } from "@/components/MasterPasswordInput";
import { INPUT_FIELD_CLASS, INPUT_FIELD_DISABLED_CLASS, MFA_LOCKOUT_BANNER_CLASS } from "@/lib/uiClasses";

const MFA_CODE_LENGTH = 6;
const MFA_DIGITS_ONLY = /\D/g;

function normalizeMfaCode(value: string): string {
  return value.replace(MFA_DIGITS_ONLY, "").slice(0, MFA_CODE_LENGTH);
}

const PASSWORD_INPUT_CLASS =
  "w-full rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm placeholder:text-vault-muted focus:border-vault-accent";

interface AuthFormProps {
  readonly titleKey: string;
  readonly descriptionKey?: string;
  readonly subtitle?: string;
  readonly password: string;
  readonly onPasswordChange: (v: string) => void;
  readonly vaultName?: string;
  readonly onVaultNameChange?: (v: string) => void;
  readonly enforceMasterPolicy?: boolean;
  readonly mfaChallenge?: boolean;
  readonly mfaCode?: string;
  readonly onMfaCodeChange?: (v: string) => void;
  readonly onMfaAutoSubmit?: (code: string) => void;
  readonly error: string | null;
  readonly loading: boolean;
  readonly submitLabelKey: string;
  readonly onSubmit: () => void;
  readonly onBack?: () => void;
  readonly onSwitchVault?: () => void;
  readonly onCancelMfaChallenge?: () => void;
  readonly mfaLockedOut?: boolean;
  readonly mfaLockoutSeconds?: number;
  readonly passwordRef: React.RefObject<HTMLInputElement | null>;
}

interface AuthFormLabels {
  readonly titleKey: string;
  readonly descriptionKey?: string;
  readonly submitLabelKey: string;
}

function resolveAuthLabels(
  mfaChallenge: boolean,
  titleKey: string,
  descriptionKey: string | undefined,
  submitLabelKey: string,
): AuthFormLabels {
  if (mfaChallenge) {
    return {
      titleKey: "auth.mfaChallengeTitle",
      descriptionKey: "auth.mfaChallengeDescription",
      submitLabelKey: "auth.mfaSubmit",
    };
  }
  return { titleKey, descriptionKey, submitLabelKey };
}

function isSubmitEnabled(
  loading: boolean,
  mfaChallenge: boolean,
  mfaCode: string,
  mfaLockedOut: boolean,
  enforceMasterPolicy: boolean | undefined,
  password: string,
): boolean {
  if (loading || mfaLockedOut) {
    return false;
  }
  if (mfaChallenge) {
    return mfaCode.length === MFA_CODE_LENGTH;
  }
  if (enforceMasterPolicy) {
    return evaluateMasterPassword(password).valid;
  }
  return password.length > 0;
}

function AuthFormHeader({
  titleKey,
  descriptionKey,
  subtitle,
}: Readonly<Pick<AuthFormProps, "subtitle"> & AuthFormLabels>) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center space-y-3 text-center">
      <AppLogo size="md" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{t(titleKey)}</h1>
        {descriptionKey ? (
          <p className="text-sm text-vault-muted">{t(descriptionKey)}</p>
        ) : null}
        {subtitle ? (
          <p className="truncate font-mono text-[11px] text-vault-muted">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

function VaultNameField({
  vaultName,
  onVaultNameChange,
}: Readonly<Required<Pick<AuthFormProps, "vaultName" | "onVaultNameChange">>>) {
  const { t } = useTranslation();

  return (
    <input
      type="text"
      value={vaultName}
      onChange={(e) => onVaultNameChange(e.target.value)}
      placeholder={t("auth.vaultNamePlaceholder")}
      className={PASSWORD_INPUT_CLASS}
    />
  );
}

function PasswordField({
  password,
  onPasswordChange,
  enforceMasterPolicy,
  passwordRef,
}: Readonly<
  Pick<AuthFormProps, "password" | "onPasswordChange" | "enforceMasterPolicy" | "passwordRef">
>) {
  const { t } = useTranslation();

  if (enforceMasterPolicy) {
    return (
      <MasterPasswordInput value={password} onChange={onPasswordChange} inputRef={passwordRef} />
    );
  }

  return (
    <input
      ref={passwordRef}
      type="password"
      value={password}
      onChange={(e) => onPasswordChange(e.target.value)}
      placeholder={t("auth.masterPasswordPlaceholder")}
      autoComplete="current-password"
      className={PASSWORD_INPUT_CLASS}
    />
  );
}

function MfaLockoutBanner({ seconds }: Readonly<{ seconds: number }>) {
  const { t } = useTranslation();
  return (
    <p
      className={MFA_LOCKOUT_BANNER_CLASS}
      role="status"
      aria-live="polite"
    >
      {t("auth.mfaLockout", { seconds })}
    </p>
  );
}

function MfaCodeField({
  mfaCode,
  onMfaCodeChange,
  onAutoSubmit,
  loading = false,
  lockedOut = false,
}: Readonly<
  Required<Pick<AuthFormProps, "mfaCode" | "onMfaCodeChange">> & {
    readonly onAutoSubmit?: (code: string) => void;
    readonly loading?: boolean;
    readonly lockedOut?: boolean;
  }
>) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const previousLengthRef = useRef(mfaCode.length);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    previousLengthRef.current = mfaCode.length;
    if (!loading && !lockedOut && mfaCode.length === 0) {
      inputRef.current?.focus();
    }
  }, [loading, lockedOut, mfaCode]);

  const handleChange = (value: string) => {
    if (lockedOut) {
      return;
    }
    const digits = normalizeMfaCode(value);
    const previousLength = previousLengthRef.current;
    previousLengthRef.current = digits.length;
    onMfaCodeChange(digits);

    if (
      digits.length === MFA_CODE_LENGTH &&
      previousLength < MFA_CODE_LENGTH &&
      !loading &&
      !lockedOut
    ) {
      onAutoSubmit?.(digits);
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="one-time-code"
      value={mfaCode}
      onChange={(e) => handleChange(e.target.value)}
      placeholder={t("auth.mfaCodePlaceholder")}
      maxLength={MFA_CODE_LENGTH}
      disabled={loading || lockedOut}
      className={`${INPUT_FIELD_CLASS} ${INPUT_FIELD_DISABLED_CLASS}`}
      aria-label={t("auth.mfaCodePlaceholder")}
      aria-disabled={lockedOut}
    />
  );
}

function AuthFormFields(props: Readonly<AuthFormProps>) {
  if (props.mfaChallenge && props.onMfaCodeChange) {
    return (
      <>
        {props.mfaLockedOut ? (
          <MfaLockoutBanner seconds={props.mfaLockoutSeconds ?? 0} />
        ) : null}
        <MfaCodeField
          mfaCode={props.mfaCode ?? ""}
          onMfaCodeChange={props.onMfaCodeChange}
          onAutoSubmit={props.onMfaAutoSubmit}
          loading={props.loading}
          lockedOut={props.mfaLockedOut ?? false}
        />
      </>
    );
  }

  const vaultName = props.vaultName;
  const onVaultNameChange = props.onVaultNameChange;
  const showVaultName = vaultName !== undefined && onVaultNameChange !== undefined;

  return (
    <>
      {showVaultName ? (
        <VaultNameField vaultName={vaultName} onVaultNameChange={onVaultNameChange} />
      ) : null}
      <PasswordField
        password={props.password}
        onPasswordChange={props.onPasswordChange}
        enforceMasterPolicy={props.enforceMasterPolicy}
        passwordRef={props.passwordRef}
      />
    </>
  );
}

function AuthFormFooter(props: Readonly<AuthFormProps>) {
  const { t } = useTranslation();

  if (props.mfaChallenge && props.onCancelMfaChallenge) {
    return (
      <button
        type="button"
        onClick={props.onCancelMfaChallenge}
        disabled={props.loading}
        className="w-full py-1 text-xs text-vault-muted hover:text-vault-text disabled:opacity-50"
      >
        {t("auth.mfaCancel")}
      </button>
    );
  }

  return (
    <>
      {props.onBack ? (
        <button
          type="button"
          onClick={props.onBack}
          className="w-full py-1 text-xs text-vault-muted hover:text-vault-text"
        >
          {t("auth.back")}
        </button>
      ) : null}
      {props.onSwitchVault ? (
        <button
          type="button"
          onClick={props.onSwitchVault}
          disabled={props.loading}
          className="w-full py-1 text-xs text-vault-muted/80 hover:text-vault-muted disabled:opacity-50"
        >
          {t("auth.switchVault")}
        </button>
      ) : null}
    </>
  );
}

export function AuthForm(props: Readonly<AuthFormProps>) {
  const { t } = useTranslation();
  const mfaChallenge = props.mfaChallenge ?? false;
  const mfaCode = props.mfaCode ?? "";
  const mfaLockedOut = props.mfaLockedOut ?? false;
  const labels = resolveAuthLabels(
    mfaChallenge,
    props.titleKey,
    props.descriptionKey,
    props.submitLabelKey,
  );
  const canSubmit = isSubmitEnabled(
    props.loading,
    mfaChallenge,
    mfaCode,
    mfaLockedOut,
    props.enforceMasterPolicy,
    props.password,
  );

  return (
    <section className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4">
        <AuthFormHeader {...labels} subtitle={props.subtitle} />
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            props.onSubmit();
          }}
        >
          <AuthFormFields {...props} mfaChallenge={mfaChallenge} mfaCode={mfaCode} />
          {props.error && !mfaLockedOut ? (
            <p className="font-mono text-xs text-vault-danger">{props.error}</p>
          ) : null}
          <button
            type="submit"
            disabled={!canSubmit}
            className={`w-full rounded bg-vault-accent py-2 text-sm font-medium text-vault-on-accent hover:bg-vault-accent-hover disabled:opacity-50 ${INPUT_FIELD_DISABLED_CLASS}`}
          >
            {props.loading ? t("common.pleaseWait") : t(labels.submitLabelKey)}
          </button>
          <AuthFormFooter {...props} mfaChallenge={mfaChallenge} />
        </form>
      </div>
    </section>
  );
}
