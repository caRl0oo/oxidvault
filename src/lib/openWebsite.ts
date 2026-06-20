import { invoke } from "@tauri-apps/api/core";

function hasHttpScheme(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}

/** Detects explicit URI schemes such as `javascript:` or `file:`. */
function hasExplicitScheme(url: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
}

function normalizeHttpUrl(url: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, error: "URL ist leer." };
  }
  if (/[\u0000-\u001F\u007F]/.test(trimmed) || /\s/.test(trimmed)) {
    return { ok: false, error: "URL enthält ungültige Zeichen." };
  }

  const normalized =
    hasHttpScheme(trimmed) || hasExplicitScheme(trimmed) ? trimmed : `https://${trimmed}`;

  return { ok: true, url: normalized };
}

/** Normalizes bare domains to https://, then validates as a safe http(s) URL. */
export function validateHttpUrl(url: string): { ok: true; url: string } | { ok: false; error: string } {
  const normalized = normalizeHttpUrl(url);
  if (!normalized.ok) {
    return normalized;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized.url);
  } catch {
    return { ok: false, error: "URL ist ungültig." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "URL muss mit http:// oder https:// beginnen." };
  }
  if (!parsed.hostname) {
    return { ok: false, error: "URL ist ungültig." };
  }

  return { ok: true, url: normalized.url };
}

export async function openWebsiteUrl(url: string): Promise<void> {
  const check = validateHttpUrl(url);
  if (!check.ok) {
    throw new Error(check.error);
  }
  await invoke<void>("open_website_url", { url: check.url });
}
