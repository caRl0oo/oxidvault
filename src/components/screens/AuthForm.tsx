// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AppLogo } from "@/components/AppLogo";
import { MasterPasswordInput, evaluateMasterPassword } from "@/components/MasterPasswordInput";
import {
  INPUT_FIELD_DISABLED_CLASS,
  MFA_LOCKOUT_BANNER_CLASS,
  UI,
} from "@/lib/uiClasses";

const MFA_CODE_LENGTH = 6;
const MFA_DIGITS_ONLY = /\D/g;

function normalizeMfaCode(value: string): string {
  return value.replace(MFA_DIGITS_ONLY, "").slice(0, MFA_CODE_LENGTH);
}

const MFA_INPUT_CLASS = `${UI.input} ${INPUT_FIELD_DISABLED_CLASS}`;
const SUBMIT_BUTTON_CLASS = `${UI.btnPrimary} w-full py-2.5 ${INPUT_FIELD_DISABLED_CLASS}`;

interface SubmitEnabledOptions {
  readonly loading: boolean;
  readonly mfaChallenge: boolean;
  readonly mfaCode: string;
  readonly mfaLockedOut: boolean;
  readonly enforceMasterPolicy?: boolean;
  readonly password: string;
  readonly isMultiUser?: boolean;
  readonly username?: string;
  readonly adminUsername?: string;
}

interface AuthFormProps {
  readonly titleKey: string;
  readonly descriptionKey?: string;
  readonly subtitle?: string;
  readonly password: string;
  readonly onPasswordChange: (v: string) => void;
  readonly vaultName?: string;
  readonly onVaultNameChange?: (v: string) => void;
  readonly adminUsername?: string;
  readonly onAdminUsernameChange?: (v: string) => void;
  readonly isMultiUser?: boolean;
  readonly username?: string;
  readonly onUsernameChange?: (v: string) => void;
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

function isSubmitEnabled(opts: SubmitEnabledOptions): boolean {
  if (opts.loading || opts.mfaLockedOut) {
    return false;
  }
  if (opts.mfaChallenge) {
    return opts.mfaCode.length === MFA_CODE_LENGTH;
  }
  if (opts.isMultiUser && !opts.username?.trim()) {
    return false;
  }
  if (opts.adminUsername !== undefined && !opts.adminUsername.trim()) {
    return false;
  }
  if (opts.enforceMasterPolicy) {
    return evaluateMasterPassword(opts.password).valid;
  }
  return opts.password.length > 0;
}

function AuthFormHeader({
  titleKey,
  descriptionKey,
  subtitle,
}: Readonly<Pick<AuthFormProps, "subtitle"> & AuthFormLabels>) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-3">
      <AppLogo size="md" className="h-12 w-12 rounded-md" />
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-lg font-semibold text-vault-text">{t(titleKey)}</h1>
        {descriptionKey ? (
          <p className="text-sm text-vault-muted">{t(descriptionKey)}</p>
        ) : null}
        {subtitle ? (
          <p className="truncate font-mono text-xs text-vault-muted">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

function UsernameField({
  username,
  onUsernameChange,
}: Readonly<{
  username: string;
  onUsernameChange: (v: string) => void;
}>) {
  const { t } = useTranslation();

  return (
    <input
      type="text"
      value={username}
      onChange={(e) => onUsernameChange(e.target.value)}
      placeholder={t("auth.username")}
      autoComplete="username"
      autoFocus
      className={UI.input}
      aria-label={t("auth.username")}
    />
  );
}

function AdminUsernameField({
  adminUsername,
  onAdminUsernameChange,
}: Readonly<{
  adminUsername: string;
  onAdminUsernameChange: (v: string) => void;
}>) {
  const { t } = useTranslation();
  return (
    <input
      type="text"
      value={adminUsername}
      onChange={(e) => onAdminUsernameChange(e.target.value)}
      placeholder={t("auth.adminUsernamePlaceholder")}
      autoComplete="username"
      className={UI.input}
    />
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
      className={UI.input}
    />
  );
}

function PasswordField({
  password,
  onPasswordChange,
  enforceMasterPolicy,
  passwordRef,
  autoFocus,
}: Readonly<
  Pick<AuthFormProps, "password" | "onPasswordChange" | "enforceMasterPolicy" | "passwordRef"> & {
    autoFocus?: boolean;
  }
>) {
  const { t } = useTranslation();

  if (enforceMasterPolicy) {
    return (
      <MasterPasswordInput
        value={password}
        onChange={onPasswordChange}
        inputRef={passwordRef}
        autoFocus={autoFocus}
      />
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
      autoFocus={autoFocus}
      className={UI.input}
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
      className={MFA_INPUT_CLASS}
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
  const showAdminUsername =
    props.adminUsername !== undefined && props.onAdminUsernameChange !== undefined;
  const showUsername =
    props.isMultiUser && props.username !== undefined && props.onUsernameChange !== undefined;
  const adminUsernameChange = props.onAdminUsernameChange;
  const usernameChange = props.onUsernameChange;

  return (
    <>
      {showVaultName ? (
        <VaultNameField vaultName={vaultName} onVaultNameChange={onVaultNameChange} />
      ) : null}
      {showAdminUsername && adminUsernameChange ? (
        <AdminUsernameField
          adminUsername={props.adminUsername ?? ""}
          onAdminUsernameChange={adminUsernameChange}
        />
      ) : null}
      {showUsername && usernameChange ? (
        <UsernameField username={props.username ?? ""} onUsernameChange={usernameChange} />
      ) : null}
      <PasswordField
        password={props.password}
        onPasswordChange={props.onPasswordChange}
        enforceMasterPolicy={props.enforceMasterPolicy}
        passwordRef={props.passwordRef}
        autoFocus={!showUsername}
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
        className={`${UI.btnGhost} w-full py-1 text-xs text-vault-muted hover:text-vault-text disabled:opacity-50`}
      >
        {t("auth.mfaCancel")}
      </button>
    );
  }

  if (props.onBack) {
    return (
      <button
        type="button"
        onClick={props.onBack}
        className={`${UI.btnGhost} w-full py-1 text-xs text-vault-muted hover:text-vault-text`}
      >
        {t("auth.back")}
      </button>
    );
  }

  return null;
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
  const canSubmit = isSubmitEnabled({
    loading: props.loading,
    mfaChallenge,
    mfaCode,
    mfaLockedOut,
    enforceMasterPolicy: props.enforceMasterPolicy,
    password: props.password,
    isMultiUser: props.isMultiUser,
    username: props.username,
    adminUsername: props.adminUsername,
  });

  return (
    <section className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 bg-vault-bg p-8">
      <AuthFormHeader {...labels} subtitle={props.subtitle} />
      <div className="w-full max-w-sm" style={{ boxShadow: "var(--shadow-md)" }}>
        <form
          className={`${UI.card} flex flex-col gap-3 p-6`}
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
            className={SUBMIT_BUTTON_CLASS}
          >
            {props.loading ? t("common.pleaseWait") : t(labels.submitLabelKey)}
          </button>
          {props.onSwitchVault && !mfaChallenge ? (
            <>
              <div className="border-t border-vault-border" />
              <button
                type="button"
                onClick={props.onSwitchVault}
                disabled={props.loading}
                className={`${UI.btnGhost} w-full py-1 text-xs text-vault-muted hover:text-vault-text disabled:opacity-50`}
              >
                {t("auth.switchVault")}
              </button>
            </>
          ) : null}
          <AuthFormFooter {...props} mfaChallenge={mfaChallenge} />
        </form>
      </div>
    </section>
  );
}
