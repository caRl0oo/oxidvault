import { useCallback, useEffect, useState } from "react";
import { generatePassword } from "@/lib/ipc";
import type { PasswordGenOptions } from "@/types/vault";
import { DEFAULT_PASSWORD_LENGTH } from "@/types/vault";

interface PasswordGeneratorModalProps {
  open: boolean;
  onClose: () => void;
  /** When set, shows an "apply to field" button (e.g. from NewSecretModal). */
  onApply?: (password: string) => void;
}

const DEFAULT_OPTIONS: PasswordGenOptions = {
  length: DEFAULT_PASSWORD_LENGTH,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
};

export function PasswordGeneratorModal({ open, onClose, onApply }: PasswordGeneratorModalProps) {
  const [options, setOptions] = useState<PasswordGenOptions>(DEFAULT_OPTIONS);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const runGenerate = useCallback(async (opts: PasswordGenOptions) => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const pwd = await generatePassword(opts);
      setPassword(pwd);
    } catch (e) {
      setError(String(e));
      setPassword("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setOptions(DEFAULT_OPTIONS);
      setCopied(false);
      setError(null);
      void runGenerate(DEFAULT_OPTIONS);
    }
  }, [open, runGenerate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const hasCharset =
    options.uppercase || options.lowercase || options.digits || options.symbols;

  const handleOptionChange = (patch: Partial<PasswordGenOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    void runGenerate(next);
  };

  const handleCopy = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      if (onApply) {
        onApply(password);
      }
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Zwischenablage nicht verfügbar");
    }
  };

  const inputClass =
    "w-full rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm placeholder:text-vault-muted focus:border-vault-accent outline-none";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="password-gen-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-vault-border bg-vault-surface shadow-xl">
        <header className="border-b border-vault-border px-5 py-4">
          <h2 id="password-gen-title" className="font-mono text-sm font-semibold">
            Passwort-Generator
          </h2>
          <p className="mt-1 text-xs text-vault-muted">
            Kryptografisch sicher · CSPRNG im Rust-Backend
          </p>
        </header>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block font-mono text-[11px] text-vault-muted">
              Länge: {options.length}
            </label>
            <input
              type="range"
              min={8}
              max={128}
              value={options.length}
              onChange={(e) =>
                handleOptionChange({ length: Number(e.target.value) })
              }
              className="w-full accent-vault-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <CharsetCheckbox
              label="Großbuchstaben (A–Z)"
              checked={options.uppercase}
              onChange={(v) => handleOptionChange({ uppercase: v })}
            />
            <CharsetCheckbox
              label="Kleinbuchstaben (a–z)"
              checked={options.lowercase}
              onChange={(v) => handleOptionChange({ lowercase: v })}
            />
            <CharsetCheckbox
              label="Zahlen (0–9)"
              checked={options.digits}
              onChange={(v) => handleOptionChange({ digits: v })}
            />
            <CharsetCheckbox
              label="Sonderzeichen (!@#…)"
              checked={options.symbols}
              onChange={(v) => handleOptionChange({ symbols: v })}
            />
          </div>

          <div className="relative">
            <input
              readOnly
              value={password}
              className={`${inputClass} pr-20 text-xs tracking-wide`}
              aria-label="Generiertes Passwort"
            />
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!password}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-vault-border px-2 py-0.5 font-mono text-[10px] text-vault-muted hover:border-vault-accent hover:text-vault-text disabled:opacity-40"
            >
              {copied ? (onApply ? "Übernommen!" : "Kopiert!") : onApply ? "Übernehmen" : "Kopieren"}
            </button>
          </div>

          {error && (
            <p className="font-mono text-xs text-vault-danger">{error}</p>
          )}
          {!hasCharset && (
            <p className="font-mono text-xs text-vault-danger">
              Mindestens ein Zeichensatz muss aktiv sein.
            </p>
          )}
        </div>

        <footer className="flex gap-2 border-t border-vault-border px-5 py-4">
          <button
            type="button"
            onClick={() => void runGenerate(options)}
            disabled={loading || !hasCharset}
            className="flex-1 rounded bg-vault-accent py-2 font-mono text-xs text-white hover:bg-vault-accent-hover disabled:opacity-50"
          >
            {loading ? "Generiere…" : "Neu generieren"}
          </button>
          {onApply && (
            <button
              type="button"
              onClick={() => {
                if (password) {
                  onApply(password);
                  onClose();
                }
              }}
              disabled={!password}
              className="rounded border border-vault-accent px-4 py-2 font-mono text-xs text-vault-accent hover:bg-vault-accent/10 disabled:opacity-50"
            >
              Übernehmen
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-vault-border px-4 py-2 font-mono text-xs text-vault-muted hover:text-vault-text"
          >
            Schließen
          </button>
        </footer>
      </div>
    </div>
  );
}

function CharsetCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded border border-vault-border px-2 py-1.5 font-mono text-[10px] text-vault-muted hover:border-vault-accent/50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-vault-accent"
      />
      {label}
    </label>
  );
}
