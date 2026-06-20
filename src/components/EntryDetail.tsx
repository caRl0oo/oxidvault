import { useState } from "react";
import { SecretTypeIcon } from "@/components/SecretTypeIcon";
import { useSecureCopy } from "@/hooks/useSecureCopy";
import { formatVaultError } from "@/lib/errors";
import { openWebsiteUrl, validateHttpUrl } from "@/lib/openWebsite";
import { ReachabilityDot } from "@/components/ReachabilityDot";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import type { ReachabilityState } from "@/types/reachability";
import type { SecretEntryFull } from "@/types/vault";
import { dbTypeLabel, isProbeableEntryType, wifiEncryptionLabel } from "@/types/vault";

interface EntryDetailProps {
  entry: SecretEntryFull;
  onLock: () => void;
  onEdit: () => void;
  onQuickConnect?: (entryId: string) => void;
  sshConnecting?: boolean;
  reachability?: ReachabilityState;
}

export function EntryDetail({
  entry,
  onLock,
  onEdit,
  onQuickConnect,
  sshConnecting,
  reachability,
}: EntryDetailProps) {
  const { copy, getLabel } = useSecureCopy();
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
            <SecretField
              label="Benutzername"
              value={entry.username}
              copyable
              copyLabel={getLabel(`${prefix}-username`)}
              onCopy={() => void copy(`${prefix}-username`, entry.username)}
            />
            <SecretField
              label="Passwort"
              value={entry.password}
              secret
              copyable
              copyLabel={getLabel(`${prefix}-password`)}
              onCopy={() => void copy(`${prefix}-password`, entry.password)}
            />
            {entry.notes && <SecretField label="Notizen" value={entry.notes} multiline />}
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
            <SecretField label="Server / IP" value={entry.host} />
            <SecretField
              label="Benutzername"
              value={entry.username}
              copyable
              copyLabel={getLabel(`${prefix}-username`)}
              onCopy={() => void copy(`${prefix}-username`, entry.username)}
            />
            <SecretField
              label="Private Key"
              value={entry.private_key}
              secret
              multiline
              revealOnly
            />
            {entry.passphrase && (
              <SecretField
                label="Passphrase"
                value={entry.passphrase}
                secret
                copyable
                copyLabel={getLabel(`${prefix}-passphrase`)}
                onCopy={() => void copy(`${prefix}-passphrase`, entry.passphrase!)}
              />
            )}
          </>
        )}

        {entry.type === "api_token" && (
          <>
            <SecretField label="Service" value={entry.service} />
            <SecretField
              label="API-Key / Token"
              value={entry.token}
              secret
              copyable
              copyLabel={getLabel(`${prefix}-token`)}
              onCopy={() => void copy(`${prefix}-token`, entry.token)}
            />
          </>
        )}

        {entry.type === "database" && (
          <>
            <SecretField label="Host / IP" value={entry.host} />
            <div className="grid grid-cols-2 gap-3">
              <SecretField label="Port" value={String(entry.port)} />
              <SecretField label="DB-Typ" value={dbTypeLabel(entry.db_type)} />
            </div>
            <SecretField label="Datenbank" value={entry.database_name} />
            <SecretField
              label="Benutzername"
              value={entry.username}
              copyable
              copyLabel={getLabel(`${prefix}-username`)}
              onCopy={() => void copy(`${prefix}-username`, entry.username)}
            />
            <SecretField
              label="Passwort"
              value={entry.password}
              secret
              copyable
              copyLabel={getLabel(`${prefix}-password`)}
              onCopy={() => void copy(`${prefix}-password`, entry.password)}
            />
          </>
        )}

        {entry.type === "network_wifi" && (
          <>
            <SecretField label="SSID" value={entry.ssid} />
            <SecretField label="Verschlüsselung" value={wifiEncryptionLabel(entry.encryption_type)} />
            <SecretField
              label="Passwort / Key"
              value={entry.password}
              secret
              copyable
              copyLabel={getLabel(`${prefix}-password`)}
              onCopy={() => void copy(`${prefix}-password`, entry.password)}
            />
          </>
        )}

        {entry.type === "secure_note" && (
          <SecretField
            label="Inhalt"
            value={entry.content}
            secret
            multiline
            copyable
            copyLabel={getLabel(`${prefix}-content`)}
            onCopy={() => void copy(`${prefix}-content`, entry.content)}
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

function SecretField({
  label,
  value,
  secret,
  multiline,
  copyable,
  copyLabel,
  onCopy,
  revealOnly,
}: {
  label: string;
  value: string;
  secret?: boolean;
  multiline?: boolean;
  copyable?: boolean;
  copyLabel?: string;
  onCopy?: () => void;
  /** Secret fields that must never be copied (e.g. SSH private keys). */
  revealOnly?: boolean;
}) {
  const [revealed, setRevealed] = useState(!secret);
  const display = secret && !revealed ? "••••••••••••" : value;
  const copied = copyLabel?.startsWith("Kopiert");

  return (
    <div className="space-y-1">
      <span className="font-mono text-[11px] text-vault-muted">{label}</span>
      <div className="flex items-start gap-2">
        {multiline ? (
          <pre className={`flex-1 overflow-auto rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all ${secret ? "max-h-96" : "max-h-48"}`}>
            {display}
          </pre>
        ) : (
          <code className="flex-1 truncate rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm">
            {display}
          </code>
        )}
        <div className="flex shrink-0 flex-col gap-1">
          {secret && (
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              className="rounded border border-vault-border px-2 py-1.5 font-mono text-[10px] text-vault-muted hover:text-vault-text"
            >
              {revealed ? "Verbergen" : "Anzeigen"}
            </button>
          )}
          {copyable && onCopy && !revealOnly && (
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
    </div>
  );
}
