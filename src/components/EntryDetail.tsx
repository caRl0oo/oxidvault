import { useCallback, useState } from "react";
import { SecretTypeIcon } from "@/components/SecretTypeIcon";
import { useSecureCopy } from "@/hooks/useSecureCopy";
import { formatVaultError } from "@/lib/errors";
import { revealSecret } from "@/lib/ipc";
import { openWebsiteUrl, validateHttpUrl } from "@/lib/openWebsite";
import { ReachabilityDot } from "@/components/ReachabilityDot";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import type { ReachabilityState } from "@/types/reachability";
import type { SecretEntryPublic, SecretField } from "@/types/vault";
import { dbTypeLabel, isProbeableEntryType, wifiEncryptionLabel } from "@/types/vault";

interface EntryDetailProps {
  entry: SecretEntryPublic;
  onLock: () => void;
  onEdit: () => void;
  onQuickConnect?: (entryId: string) => void;
  sshConnecting?: boolean;
  reachability?: ReachabilityState;
}

/** Best-effort overwrite of a short-lived secret string in JS memory. */
function discardRevealed(value: string | null): null {
  if (value) {
    value.replace(/./g, "\0");
  }
  return null;
}

export function EntryDetail({
  entry,
  onLock,
  onEdit,
  onQuickConnect,
  sshConnecting,
  reachability,
}: EntryDetailProps) {
  const { copy, copySecret, getLabel } = useSecureCopy();
  const prefix = entry.id;
  const [openingWebsite, setOpeningWebsite] = useState(false);
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const canOpenWebsite =
    entry.type === "web_login" && validateHttpUrl(entry.url).ok;

  const handleOpenWebsite = async () => {
    if (entry.type !== "web_login") return;
    setOpeningWebsite(true);
    setWebsiteError(null);
    try {
      await openWebsiteUrl(entry.url);
    } catch (e) {
      setWebsiteError(formatVaultError(e));
    } finally {
      setOpeningWebsite(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-lg space-y-5">
        <header className="flex items-start gap-3">
          <div className="mt-0.5 rounded bg-vault-border/60 p-2 text-vault-accent">
            <SecretTypeIcon kind={entry.type} className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-mono text-lg font-semibold">{entry.title}</h2>
              {isProbeableEntryType(entry.type) && (
                <ReachabilityDot state={reachability} size="md" />
              )}
            </div>
            <ExpiryBadge expiresAt={entry.expires_at} />
          </div>
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 rounded border border-vault-border px-3 py-1.5 font-mono text-xs text-vault-muted hover:border-vault-accent hover:text-vault-accent"
          >
            Bearbeiten
          </button>
        </header>

        {(entry.folder || (entry.tags && entry.tags.length > 0)) && (
          <div className="flex flex-wrap items-center gap-2">
            {entry.folder && (
              <span className="rounded border border-vault-border px-2 py-0.5 font-mono text-[10px] text-vault-muted">
                {entry.folder}
              </span>
            )}
            {(entry.tags ?? []).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-vault-tag/40 bg-vault-tag/15 px-2 py-0.5 font-mono text-[10px] text-vault-tag"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {entry.type === "web_login" && (
          <>
            <div className="space-y-1">
              <span className="font-mono text-[11px] text-vault-muted">URL</span>
              <div className="flex items-start gap-2">
                <code className="flex-1 truncate rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm">
                  {entry.url}
                </code>
                <button
                  type="button"
                  onClick={() => void handleOpenWebsite()}
                  disabled={openingWebsite || !canOpenWebsite}
                  title="Website öffnen"
                  aria-label="Website öffnen"
                  className="flex shrink-0 items-center gap-1 rounded border border-vault-border px-2.5 py-2 font-mono text-xs text-vault-accent transition hover:border-vault-accent hover:bg-vault-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span aria-hidden="true">{openingWebsite ? "…" : "↗"}</span>
                  <span className="hidden sm:inline">Website öffnen</span>
                </button>
              </div>
              {websiteError && (
                <p className="font-mono text-xs text-vault-danger">{websiteError}</p>
              )}
            </div>
            <PlainField
              label="Benutzername"
              value={entry.username}
              copyable
              copyLabel={getLabel(`${prefix}-username`)}
              onCopy={() => void copy(`${prefix}-username`, entry.username)}
            />
            {entry.has_password && (
              <SecureField
                entryId={entry.id}
                field="password"
                label="Passwort"
                copyFieldId={`${prefix}-password`}
                copyLabel={getLabel(`${prefix}-password`)}
                onCopy={() => void copySecret(`${prefix}-password`, entry.id, "password")}
              />
            )}
            {entry.has_notes && (
              <SecureField
                entryId={entry.id}
                field="notes"
                label="Notizen"
                multiline
                copyFieldId={`${prefix}-notes`}
                copyLabel={getLabel(`${prefix}-notes`)}
                onCopy={() => void copySecret(`${prefix}-notes`, entry.id, "notes")}
              />
            )}
          </>
        )}

        {entry.type === "ssh_key" && (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={sshConnecting || !onQuickConnect}
                onClick={() => onQuickConnect?.(entry.id)}
                className="flex-1 rounded bg-vault-accent py-2 font-mono text-xs text-white hover:bg-vault-accent-hover disabled:opacity-50"
              >
                {sshConnecting ? "Verbinde…" : "Quick Connect"}
              </button>
            </div>
            <PlainField label="Server / IP" value={entry.host} />
            <PlainField
              label="Benutzername"
              value={entry.username}
              copyable
              copyLabel={getLabel(`${prefix}-username`)}
              onCopy={() => void copy(`${prefix}-username`, entry.username)}
            />
            {entry.has_private_key && (
              <SecureField
                entryId={entry.id}
                field="private_key"
                label="Private Key"
                multiline
                revealOnly
              />
            )}
            {entry.has_passphrase && (
              <SecureField
                entryId={entry.id}
                field="passphrase"
                label="Passphrase"
                copyFieldId={`${prefix}-passphrase`}
                copyLabel={getLabel(`${prefix}-passphrase`)}
                onCopy={() => void copySecret(`${prefix}-passphrase`, entry.id, "passphrase")}
              />
            )}
          </>
        )}

        {entry.type === "api_token" && (
          <>
            <PlainField label="Service" value={entry.service} />
            {entry.has_token && (
              <SecureField
                entryId={entry.id}
                field="token"
                label="API-Key / Token"
                copyFieldId={`${prefix}-token`}
                copyLabel={getLabel(`${prefix}-token`)}
                onCopy={() => void copySecret(`${prefix}-token`, entry.id, "token")}
              />
            )}
          </>
        )}

        {entry.type === "database" && (
          <>
            <PlainField label="Host / IP" value={entry.host} />
            <div className="grid grid-cols-2 gap-3">
              <PlainField label="Port" value={String(entry.port)} />
              <PlainField label="DB-Typ" value={dbTypeLabel(entry.db_type)} />
            </div>
            <PlainField label="Datenbank" value={entry.database_name} />
            <PlainField
              label="Benutzername"
              value={entry.username}
              copyable
              copyLabel={getLabel(`${prefix}-username`)}
              onCopy={() => void copy(`${prefix}-username`, entry.username)}
            />
            {entry.has_password && (
              <SecureField
                entryId={entry.id}
                field="password"
                label="Passwort"
                copyFieldId={`${prefix}-password`}
                copyLabel={getLabel(`${prefix}-password`)}
                onCopy={() => void copySecret(`${prefix}-password`, entry.id, "password")}
              />
            )}
          </>
        )}

        {entry.type === "network_wifi" && (
          <>
            <PlainField label="SSID" value={entry.ssid} />
            <PlainField
              label="Verschlüsselung"
              value={wifiEncryptionLabel(entry.encryption_type)}
            />
            {entry.has_password && (
              <SecureField
                entryId={entry.id}
                field="password"
                label="Passwort / Key"
                copyFieldId={`${prefix}-password`}
                copyLabel={getLabel(`${prefix}-password`)}
                onCopy={() => void copySecret(`${prefix}-password`, entry.id, "password")}
              />
            )}
          </>
        )}

        {entry.type === "secure_note" && entry.has_content && (
          <SecureField
            entryId={entry.id}
            field="content"
            label="Inhalt"
            multiline
            copyFieldId={`${prefix}-content`}
            copyLabel={getLabel(`${prefix}-content`)}
            onCopy={() => void copySecret(`${prefix}-content`, entry.id, "content")}
          />
        )}

        <button
          type="button"
          onClick={onLock}
          className="rounded border border-vault-border px-3 py-1.5 font-mono text-xs text-vault-muted hover:border-vault-danger hover:text-vault-danger"
        >
          Vault sperren
        </button>
      </div>
    </div>
  );
}

function PlainField({
  label,
  value,
  copyable,
  copyLabel,
  onCopy,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  copyLabel?: string;
  onCopy?: () => void;
}) {
  const copied = copyLabel?.startsWith("Kopiert");

  return (
    <div className="space-y-1">
      <span className="font-mono text-[11px] text-vault-muted">{label}</span>
      <div className="flex items-start gap-2">
        <code className="flex-1 truncate rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm">
          {value}
        </code>
        {copyable && onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className={`shrink-0 rounded border px-2 py-1.5 font-mono text-[10px] transition ${
              copied
                ? "border-vault-success text-vault-success"
                : "border-vault-border text-vault-muted hover:border-vault-accent hover:text-vault-accent"
            }`}
          >
            {copyLabel ?? "Kopieren"}
          </button>
        )}
      </div>
    </div>
  );
}

function SecureField({
  entryId,
  field,
  label,
  multiline,
  copyFieldId,
  copyLabel,
  onCopy,
  revealOnly,
}: {
  entryId: string;
  field: SecretField;
  label: string;
  multiline?: boolean;
  copyFieldId?: string;
  copyLabel?: string;
  onCopy?: () => void;
  revealOnly?: boolean;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copied = copyLabel?.startsWith("Kopiert");

  const handleReveal = useCallback(async () => {
    if (revealed !== null) {
      setRevealed((v) => discardRevealed(v));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await revealSecret(entryId, field);
      console.warn(result.warning);
      setRevealed(result.value);
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  }, [entryId, field, revealed]);

  const display = revealed ?? "••••••••••••";

  return (
    <div className="space-y-1">
      <span className="font-mono text-[11px] text-vault-muted">{label}</span>
      <div className="flex items-start gap-2">
        {multiline ? (
          <pre className="max-h-96 flex-1 overflow-auto rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
            {display}
          </pre>
        ) : (
          <code className="flex-1 truncate rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm">
            {display}
          </code>
        )}
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            onClick={() => void handleReveal()}
            disabled={loading}
            className="rounded border border-vault-border px-2 py-1.5 font-mono text-[10px] text-vault-muted hover:text-vault-text disabled:opacity-50"
          >
            {loading ? "…" : revealed ? "Verbergen" : "Anzeigen"}
          </button>
          {onCopy && copyFieldId && !revealOnly && (
            <button
              type="button"
              onClick={onCopy}
              className={`rounded border px-2 py-1.5 font-mono text-[10px] transition ${
                copied
                  ? "border-vault-success text-vault-success"
                  : "border-vault-border text-vault-muted hover:border-vault-accent hover:text-vault-accent"
              }`}
            >
              {copyLabel ?? "Kopieren"}
            </button>
          )}
        </div>
      </div>
      {error && <p className="font-mono text-xs text-vault-danger">{error}</p>}
    </div>
  );
}
