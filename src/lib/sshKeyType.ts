// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Header-only classification for supported SSH private key types.
 *
 * Security constraints:
 * - No passphrase required.
 * - No key material is logged or returned (only the classification enum).
 *
 * Note: classification is best-effort. Unrecognized formats return `unknown`.
 */
export type SshPrivateKeyType = "ed25519" | "ecdsa" | "rsa" | "dsa" | "unknown";

const OPENSSH_BEGIN = "-----BEGIN OPENSSH PRIVATE KEY-----";
const OPENSSH_END = "-----END OPENSSH PRIVATE KEY-----";

const RSA_BEGIN = "-----BEGIN RSA PRIVATE KEY-----";

const DSA_BEGIN = "-----BEGIN DSA PRIVATE KEY-----";

const PKCS8_BEGIN = "-----BEGIN PRIVATE KEY-----";
const PKCS8_END = "-----END PRIVATE KEY-----";

const ENCRYPTED_PKCS8_BEGIN = "-----BEGIN ENCRYPTED PRIVATE KEY-----";
const ENCRYPTED_PKCS8_END = "-----END ENCRYPTED PRIVATE KEY-----";

const EC_BEGIN = "-----BEGIN EC PRIVATE KEY-----";
const EC_END = "-----END EC PRIVATE KEY-----";

const PPK_PREFIX = "PuTTY-User-Key-File-";

const OID_RSA_ENCRYPTION_DER = new Uint8Array([
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
]);
const OID_DSA_DER = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x01]);
const OID_ED25519_DER = new Uint8Array([0x06, 0x03, 0x2b, 0x65, 0x70]);
const OID_EC_PUBLIC_KEY_DER = new Uint8Array([
  0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
]);

function normalizeKeyText(input: string): string {
  let s = input.trim().replaceAll('\uFEFF', "");
  if (s.includes(String.raw`\n`) || s.includes(String.raw`\r\n`)) {
    s = s.replaceAll(String.raw`\r\n`, "\n").replaceAll(String.raw`\n`, "\n");
  }
  s = s.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return s;
}

function firstNonEmptyLine(input: string): string {
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

function extractPemBody(normalized: string, begin: string, end: string): Uint8Array | null {
  const start = normalized.indexOf(begin);
  if (start === -1) return null;
  const afterBegin = start + begin.length;
  const endPos = normalized.indexOf(end, afterBegin);
  if (endPos === -1) return null;

  const body = normalized.slice(afterBegin, endPos);
  const cleaned = body.replace(/\s+/g, "");
  if (!cleaned) return null;

  try {
    const binary = atob(cleaned);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      // `atob()` yields a binary string where each code unit is a byte (0..255).
      // `codePointAt()` avoids deprecated `charCodeAt()` usage.
      out[i] = binary.codePointAt(i)! & 0xff;
    }
    return out;
  } catch {
    return null;
  }
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  if (needle.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function classifyOpenSsh(decoded: Uint8Array): SshPrivateKeyType {
  if (containsAsciiSequence(decoded, "ssh-rsa")) return "rsa";
  if (containsAsciiSequence(decoded, "ssh-dss")) return "dsa";
  if (containsAsciiSequence(decoded, "ssh-ed25519")) return "ed25519";
  if (containsAsciiSequence(decoded, "ecdsa-sha2")) return "ecdsa";
  return "unknown";
}

function containsAsciiSequence(haystack: Uint8Array, s: string): boolean {
  const bytes = new TextEncoder().encode(s);
  return containsBytes(haystack, bytes);
}

function classifyPkcs8OrEc(decoded: Uint8Array): SshPrivateKeyType {
  if (containsBytes(decoded, OID_RSA_ENCRYPTION_DER)) return "rsa";
  if (containsBytes(decoded, OID_DSA_DER)) return "dsa";
  if (containsBytes(decoded, OID_ED25519_DER)) return "ed25519";
  if (containsBytes(decoded, OID_EC_PUBLIC_KEY_DER)) return "ecdsa";
  return "unknown";
}

export function detectPrivateKeyType(privateKey: string): SshPrivateKeyType {
  const normalized = normalizeKeyText(privateKey);
  const first = firstNonEmptyLine(normalized);
  const lowerNorm = normalized.toLowerCase();

  if (first.startsWith(PPK_PREFIX)) {
    return detectPpkType(lowerNorm);
  }

  if (first.startsWith(RSA_BEGIN)) return "rsa";
  if (first.startsWith(DSA_BEGIN)) return "dsa";

  return detectByBeginMarker(normalized, first);
}

function detectPpkType(lowerNorm: string): SshPrivateKeyType {
  for (const line of lowerNorm.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("key-type:")) continue;
    const value = trimmed.slice("key-type:".length).trim();
    if (value.includes("ssh-rsa")) return "rsa";
    if (value.includes("ssh-dss")) return "dsa";
    if (value.includes("ssh-ed25519")) return "ed25519";
    if (value.includes("ecdsa-sha2")) return "ecdsa";
  }
  return "unknown";
}

function detectByBeginMarker(normalized: string, first: string): SshPrivateKeyType {
  if (first.startsWith(OPENSSH_BEGIN)) {
    const decoded = extractPemBody(normalized, OPENSSH_BEGIN, OPENSSH_END);
    return decoded ? classifyOpenSsh(decoded) : "unknown";
  }
  if (first.startsWith(PKCS8_BEGIN)) {
    const decoded = extractPemBody(normalized, PKCS8_BEGIN, PKCS8_END);
    return decoded ? classifyPkcs8OrEc(decoded) : "unknown";
  }
  if (first.startsWith(ENCRYPTED_PKCS8_BEGIN)) {
    const decoded = extractPemBody(normalized, ENCRYPTED_PKCS8_BEGIN, ENCRYPTED_PKCS8_END);
    return decoded ? classifyPkcs8OrEc(decoded) : "unknown";
  }
  if (first.startsWith(EC_BEGIN)) {
    const decoded = extractPemBody(normalized, EC_BEGIN, EC_END);
    return decoded ? classifyPkcs8OrEc(decoded) : "unknown";
  }

  return "unknown";
}

export function isUnsupportedSshKeyType(type: SshPrivateKeyType): boolean {
  return type === "rsa" || type === "dsa";
}

