import { useMemo } from "react";
import {
  evaluateMasterPassword,
  MIN_MASTER_PASSWORD_LENGTH,
} from "@/lib/passwordPolicy";

interface MasterPasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function MasterPasswordInput({
  value,
  onChange,
  inputRef,
}: MasterPasswordInputProps) {
  const policy = useMemo(() => evaluateMasterPassword(value), [value]);

  const borderClass =
    value.length === 0
      ? "border-vault-border focus:border-vault-accent"
      : policy.valid
        ? "border-vault-success focus:border-vault-success"
        : "border-vault-danger focus:border-vault-danger";

  const hintClass =
    value.length === 0
      ? "text-vault-muted"
      : policy.valid
        ? "text-vault-success"
        : "text-vault-danger";

  const strengthPercent = ((policy.strengthScore + 1) / 5) * 100;
  const strengthBarClass =
    policy.strengthScore >= 3
      ? "bg-vault-success"
      : policy.strengthScore >= 2
        ? "bg-yellow-500"
        : "bg-vault-danger";

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Master-Passwort"
        autoComplete="new-password"
        minLength={MIN_MASTER_PASSWORD_LENGTH}
        className={`w-full rounded border bg-vault-bg px-3 py-2 font-mono text-sm placeholder:text-vault-muted outline-none transition-colors ${borderClass}`}
      />

      <div className="space-y-1">
        <div className="h-1 overflow-hidden rounded-full bg-vault-border">
          <div
            className={`h-full transition-all duration-300 ${strengthBarClass}`}
            style={{ width: value.length > 0 ? `${strengthPercent}%` : "0%" }}
          />
        </div>
        <p className={`font-mono text-[11px] ${hintClass}`}>{policy.hint}</p>
        {value.length > 0 && (
          <ul className="space-y-0.5 font-mono text-[10px] text-vault-muted">
            <li className={policy.lengthOk ? "text-vault-success" : "text-vault-danger"}>
              {policy.lengthOk ? "✓" : "○"} Mindestens {MIN_MASTER_PASSWORD_LENGTH} Zeichen
            </li>
            <li className={policy.notCommon ? "text-vault-success" : "text-vault-danger"}>
              {policy.notCommon ? "✓" : "○"} Kein häufiges Passwort
            </li>
            <li
              className={
                policy.strengthScore >= 2 ? "text-vault-success" : "text-vault-danger"
              }
            >
              {policy.strengthScore >= 2 ? "✓" : "○"} Ausreichende Entropie (zxcvbn)
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}

export { evaluateMasterPassword };
