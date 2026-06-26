// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  evaluateMasterPasswordWithMin,
  MIN_MASTER_PASSWORD_LENGTH,
  type PasswordPolicyState,
} from "@/lib/passwordPolicy";

interface MasterPasswordInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly id?: string;
  readonly inputRef?: React.RefObject<HTMLInputElement | null>;
  readonly minLength?: number;
  readonly placeholder?: string;
  readonly autoComplete?: string;
  readonly showPolicyHints?: boolean;
  readonly autoFocus?: boolean;
}

function passwordBorderClass(value: string, valid: boolean): string {
  if (value.length === 0) {
    return "border-vault-border focus:border-vault-accent";
  }
  if (valid) {
    return "border-vault-success focus:border-vault-success";
  }
  return "border-vault-danger focus:border-vault-danger";
}

function passwordHintClass(value: string, valid: boolean): string {
  if (value.length === 0) {
    return "text-vault-muted";
  }
  if (valid) {
    return "text-vault-success";
  }
  return "text-vault-danger";
}

function strengthBarClass(strengthScore: number): string {
  if (strengthScore >= 3) {
    return "bg-vault-success";
  }
  if (strengthScore >= 2) {
    return "bg-yellow-500";
  }
  return "bg-vault-danger";
}

function checklistItemClass(ok: boolean): string {
  return ok ? "text-vault-success" : "text-vault-danger";
}

function checklistMark(ok: boolean): string {
  return ok ? "✓" : "○";
}

interface PolicyHintsProps {
  readonly value: string;
  readonly minLength: number;
  readonly policy: PasswordPolicyState;
}

function PolicyHints({ value, minLength, policy }: Readonly<PolicyHintsProps>) {
  const { t } = useTranslation();
  const strengthPercent = ((policy.strengthScore + 1) / 5) * 100;
  const barWidth = value.length > 0 ? `${strengthPercent}%` : "0%";

  return (
    <div className="space-y-1">
      <div className="h-1 overflow-hidden rounded-full bg-vault-border">
        <div
          className={`h-full transition-all duration-300 ${strengthBarClass(policy.strengthScore)}`}
          style={{ width: barWidth }}
        />
      </div>
      <p className={`font-mono text-[11px] ${passwordHintClass(value, policy.valid)}`}>
        {policy.hint}
      </p>
      {value.length > 0 ? (
        <ul className="space-y-0.5 font-mono text-[10px] text-vault-muted">
          <li className={checklistItemClass(policy.lengthOk)}>
            {checklistMark(policy.lengthOk)} {t("passwordPolicy.checkLength", { min: minLength })}
          </li>
          <li className={checklistItemClass(policy.notCommon)}>
            {checklistMark(policy.notCommon)} {t("passwordPolicy.checkNotCommon")}
          </li>
          <li className={checklistItemClass(policy.strengthScore >= 2)}>
            {checklistMark(policy.strengthScore >= 2)} {t("passwordPolicy.checkEntropy")}
          </li>
        </ul>
      ) : null}
    </div>
  );
}

export function MasterPasswordInput({
  value,
  onChange,
  id,
  inputRef,
  minLength = MIN_MASTER_PASSWORD_LENGTH,
  placeholder,
  autoComplete = "new-password",
  showPolicyHints = true,
  autoFocus,
}: Readonly<MasterPasswordInputProps>) {
  const { t, i18n } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("auth.masterPasswordPlaceholder");
  const policy = useMemo(
    () => evaluateMasterPasswordWithMin(value, minLength),
    [value, minLength, i18n.language],
  );

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={resolvedPlaceholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        minLength={minLength}
        className={`w-full rounded border bg-vault-bg px-3 py-2 font-mono text-sm placeholder:text-vault-muted outline-none transition-colors ${passwordBorderClass(value, policy.valid)}`}
      />

      {showPolicyHints ? (
        <PolicyHints value={value} minLength={minLength} policy={policy} />
      ) : null}
    </div>
  );
}

export { evaluateMasterPassword } from "@/lib/passwordPolicy";
