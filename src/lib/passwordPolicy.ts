// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import * as zxcvbnCommon from "@zxcvbn-ts/language-common";
import * as zxcvbnEn from "@zxcvbn-ts/language-en";
import i18n from "@/lib/i18n";

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

export interface PasswordPolicyState {
  lengthOk: boolean;
  notCommon: boolean;
  strengthScore: number;
  strengthLabel: string;
  valid: boolean;
  hint: string;
}

function strengthLabel(score: number): string {
  const key = `passwordPolicy.strength.${score}`;
  if (i18n.exists(key)) {
    return i18n.t(key);
  }
  return i18n.t("passwordPolicy.strength.0");
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
  const label = strengthLabel(strengthScore);

  const strengthOk = password.length === 0 ? false : strengthScore >= MIN_ZXCVBN_SCORE;
  const valid = lengthOk && notCommon && strengthOk;

  let hint: string;
  if (password.length === 0) {
    hint = i18n.t("passwordPolicy.hintEmpty", { min: minLength });
  } else if (!lengthOk) {
    hint = i18n.t("passwordPolicy.hintTooShort", {
      remaining: minLength - password.length,
      current: password.length,
      min: minLength,
    });
  } else if (!notCommon) {
    hint = i18n.t("passwordPolicy.hintCommon");
  } else if (strengthOk) {
    hint = i18n.t("passwordPolicy.hintStrongOk", { label });
  } else {
    hint = i18n.t("passwordPolicy.hintWeak", { label });
  }

  return {
    lengthOk,
    notCommon,
    strengthScore,
    strengthLabel: label,
    valid,
    hint,
  };
}
