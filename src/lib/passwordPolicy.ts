import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import * as zxcvbnCommon from "@zxcvbn-ts/language-common";
import * as zxcvbnEn from "@zxcvbn-ts/language-en";

let zxcvbnReady = false;

function ensureZxcvbn() {
  if (zxcvbnReady) return;
  zxcvbnOptions.setOptions({
    dictionary: {
      ...zxcvbnCommon.dictionary,
      ...zxcvbnEn.dictionary,
    },
    graphs: zxcvbnCommon.adjacencyGraphs,
  });
  zxcvbnReady = true;
}

/** Must stay in sync with `vault-core/src/policy.rs` */
export const MIN_MASTER_PASSWORD_LENGTH = 12;

/** Minimum zxcvbn score (0–4) required to create a vault */
export const MIN_ZXCVBN_SCORE = 2;

const COMMON_PASSWORDS = new Set(
  [
    "password",
    "password1",
    "password12",
    "password123",
    "123456",
    "1234567",
    "12345678",
    "123456789",
    "1234567890",
    "admin",
    "admin123",
    "administrator",
    "letmein",
    "welcome",
    "welcome1",
    "qwerty",
    "qwerty123",
    "abc123",
    "abc123456789",
    "passwort",
    "passwort123",
    "master",
    "master123",
    "changeme",
    "secret",
    "secret123",
    "oxidvault",
    "vault123",
    "11111111",
    "00000000",
    "iloveyou",
    "sunshine",
    "monkey",
    "dragon",
    "football",
    "baseball",
    "trustno1",
    "superman",
    "batman",
    "access",
    "root",
    "toor",
    "p@ssw0rd",
    "passw0rd",
  ].map((p) => p.toLowerCase()),
);

export const STRENGTH_LABELS = [
  "Sehr schwach",
  "Schwach",
  "Mittel",
  "Stark",
  "Sehr stark",
] as const;

export interface PasswordPolicyState {
  lengthOk: boolean;
  notCommon: boolean;
  strengthScore: number;
  strengthLabel: string;
  valid: boolean;
  hint: string;
}

export function evaluateMasterPassword(password: string): PasswordPolicyState {
  return evaluateMasterPasswordWithMin(password, MIN_MASTER_PASSWORD_LENGTH);
}

export function evaluateMasterPasswordWithMin(
  password: string,
  minLength: number,
): PasswordPolicyState {
  const lengthOk = password.length >= minLength;
  const notCommon = password.length > 0 && !COMMON_PASSWORDS.has(password.trim().toLowerCase());

  ensureZxcvbn();
  const result = password.length > 0 ? zxcvbn(password) : null;
  const strengthScore = result?.score ?? 0;
  const strengthLabel = STRENGTH_LABELS[strengthScore] ?? STRENGTH_LABELS[0];

  const strengthOk = password.length === 0 ? false : strengthScore >= MIN_ZXCVBN_SCORE;
  const valid = lengthOk && notCommon && strengthOk;

  let hint: string;
  if (password.length === 0) {
    hint = `Mindestens ${minLength} Zeichen erforderlich`;
  } else if (!lengthOk) {
    hint = `Noch ${minLength - password.length} Zeichen (${password.length}/${minLength})`;
  } else if (!notCommon) {
    hint = "Passwort ist zu häufig — bitte ein einzigartiges wählen";
  } else if (strengthOk) {
    hint = `Passwortstärke: ${strengthLabel} — Richtlinie erfüllt`;
  } else {
    hint = `Passwortstärke: ${strengthLabel} — bitte verstärken`;
  }

  return {
    lengthOk,
    notCommon,
    strengthScore,
    strengthLabel,
    valid,
    hint,
  };
}
