// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useState } from "react";
import { Terminal } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { DeleteConfirmationModal } from "@/components/DeleteConfirmationModal";
import { SecretTypeIcon } from "@/components/SecretTypeIcon";
import { VaultButton } from "@/components/ui/VaultButton";
import { useSecureCopy } from "@/hooks/useSecureCopy";
import { formatVaultError } from "@/lib/errors";
import { revealSecret } from "@/lib/ipc";
import { openWebsiteUrl, validateHttpUrl } from "@/lib/openWebsite";
import { revealToggleLabel } from "@/lib/revealLabels";
import { runAsync } from "@/lib/runAsync";
import { getDbTypeLabel, getWifiEncryptionLabel } from "@/lib/vaultLabels";
import { ReachabilityDot } from "@/components/ReachabilityDot";
import { SshSessionStatusDot } from "@/components/SshSessionStatusDot";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import type { ReachabilityState } from "@/types/reachability";
import type { SshSessionStatus } from "@/types/ssh";
import type { SecretEntryPublic, SecretField } from "@/types/vault";
import { isProbeableEntryType } from "@/types/vault";
import { UI } from "@/lib/uiClasses";

interface EntryDetailProps {
  readonly entry: SecretEntryPublic;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly deleteLoading?: boolean;
  readonly onQuickConnect?: (entryId: string) => void;
  readonly onResetSshFingerprint?: (entryId: string) => void;
  readonly sshConnecting?: boolean;
  readonly reachability?: ReachabilityState;
  readonly sshSessionStatus?: SshSessionStatus | null;
}

/** Best-effort overwrite of a short-lived secret string in JS memory. */
function discardRevealed(value: string | null): null {
  if (value) {
    absorbDiscarded(value.replace(/./g, "\0"));
  }
  return null;
}

function absorbDiscarded(_discarded: string): void {
  /* Best-effort: consume replaced string so the caller can drop its reference. */
}

export function EntryDetail({
  entry,
  onEdit,
  onDelete,
  deleteLoading = false,
  onQuickConnect,
  onResetSshFingerprint,
  sshConnecting,
  reachability,
  sshSessionStatus,
}: Readonly<EntryDetailProps>) {
  const { t } = useTranslation();
  const { copy, copySecret, getLabel, isCopied } = useSecureCopy();
  const prefix = entry.id;
  const [openingWebsite, setOpeningWebsite] = useState(false);
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [resettingFingerprint, setResettingFingerprint] = useState(false);
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
    <div className="vault-main-panel">
      <div className="vault-main-scroll">
      <div key={entry.id} className="vault-content-enter mx-auto w-full max-w-lg">
        <header className="flex items-start justify-between border-b border-vault-border px-6 py-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-vault-accent-subtle text-vault-accent"
              style={{ boxShadow: "0 0 0 1px color-mix(in srgb, var(--color-vault-accent) 20%, transparent) inset" }}
            >
              <SecretTypeIcon kind={entry.type} className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <h1
                className="truncate text-base font-bold text-vault-text"
                style={{ letterSpacing: "-0.02em" }}
              >
                {entry.title}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {entry.folder ? (
                  <span className="font-mono text-[11px] text-vault-muted">{entry.folder}</span>
                ) : null}
                {isProbeableEntryType(entry.type) ? (
                  <ReachabilityDot state={reachability} size="md" />
                ) : null}
                <ExpiryBadge expiresAt={entry.expires_at} />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onEdit} className={`${UI.btnSecondary} px-3 py-1.5 text-xs`}>
              {t("common.edit")}
            </button>
            <VaultButton
              variant="outline"
              tone="danger"
              size="sm"
              onClick={() => setDeleteModalOpen(true)}
              disabled={deleteLoading}
            >
              {t("entry.delete")}
            </VaultButton>
          </div>
        </header>

        <DeleteConfirmationModal
          open={deleteModalOpen}
          entryTitle={entry.title}
          loading={deleteLoading}
          onClose={() => setDeleteModalOpen(false)}
          onConfirm={() => {
            setDeleteModalOpen(false);
            onDelete();
          }}
        />

        <div className="flex flex-col gap-5 p-6">
        {(entry.tags && entry.tags.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
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
            <div className="flex flex-col gap-1.5">
              <span className={UI.fieldLabel}>{t("entry.url")}</span>
              <div className="flex items-start gap-2">
                <div className="flex-1 truncate border-l-2 border-vault-border py-1 pl-3 font-mono text-sm text-vault-text">{entry.url}</div>
                <button
                  type="button"
                  onClick={() => runAsync(handleOpenWebsite)}
                  disabled={openingWebsite || !canOpenWebsite}
                  title={t("entry.openWebsite")}
                  aria-label={t("entry.openWebsite")}
                  className={`${UI.btnSecondary} shrink-0 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <span aria-hidden="true">{openingWebsite ? "…" : "↗"}</span>
                  <span className="hidden sm:inline">{t("entry.openWebsite")}</span>
                </button>
              </div>
              {websiteError ? (
                <p className="font-mono text-xs text-vault-danger">{websiteError}</p>
              ) : null}
            </div>
            <PlainField
              label={t("entry.username")}
              value={entry.username}
              copyable
              copyLabel={getLabel(`${prefix}-username`)}
              copied={isCopied(`${prefix}-username`)}
              onCopy={() => runAsync(() => copy(`${prefix}-username`, entry.username))}
            />
            {entry.has_password && (
              <SecureField
                entryId={entry.id}
                field="password"
                label={t("entry.password")}
                copyFieldId={`${prefix}-password`}
                copyLabel={getLabel(`${prefix}-password`)}
                copied={isCopied(`${prefix}-password`)}
                onCopy={() =>
                  runAsync(() => copySecret(`${prefix}-password`, entry.id, "password"))
                }
              />
            )}
            {entry.has_notes && (
              <SecureField
                entryId={entry.id}
                field="notes"
                label={t("entry.notes")}
                multiline
                copyFieldId={`${prefix}-notes`}
                copyLabel={getLabel(`${prefix}-notes`)}
                copied={isCopied(`${prefix}-notes`)}
                onCopy={() => runAsync(() => copySecret(`${prefix}-notes`, entry.id, "notes"))}
              />
            )}
          </>
        )}

        {entry.type === "ssh_key" && (
          <>
            <div className="px-0">
              <button
                type="button"
                disabled={sshConnecting || !onQuickConnect}
                onClick={() => onQuickConnect?.(entry.id)}
                className={`${UI.btnPrimary} gap-2`}
              >
                {sshSessionStatus ? (
                  <SshSessionStatusDot status={sshSessionStatus} size="md" />
                ) : (
                  <Terminal size={14} weight="light" aria-hidden />
                )}
                {sshConnecting ? t("entry.connecting") : t("entry.quickConnect")}
              </button>
            </div>
            <PlainField label={t("entry.serverIp")} value={entry.host} />
            <PlainField
              label={t("entry.username")}
              value={entry.username}
              copyable
              copyLabel={getLabel(`${prefix}-username`)}
              copied={isCopied(`${prefix}-username`)}
              onCopy={() => runAsync(() => copy(`${prefix}-username`, entry.username))}
            />
            {entry.has_private_key && (
              <SecureField
                entryId={entry.id}
                field="private_key"
                label={t("entry.privateKey")}
                multiline
                revealOnly
              />
            )}
            {entry.has_passphrase && (
              <SecureField
                entryId={entry.id}
                field="passphrase"
                label={t("entry.sshKeyPassphrase")}
                copyFieldId={`${prefix}-passphrase`}
                copyLabel={getLabel(`${prefix}-passphrase`)}
                copied={isCopied(`${prefix}-passphrase`)}
                onCopy={() =>
                  runAsync(() => copySecret(`${prefix}-passphrase`, entry.id, "passphrase"))
                }
              />
            )}
            {entry.has_known_host_fingerprint && onResetSshFingerprint && (
              <VaultButton
                variant="outline"
                size="sm"
                disabled={resettingFingerprint}
                onClick={() => {
                  setResettingFingerprint(true);
                  runAsync(async () => {
                    try {
                      onResetSshFingerprint(entry.id);
                    } finally {
                      setResettingFingerprint(false);
                    }
                  });
                }}
              >
                {resettingFingerprint ? t("common.loading") : t("ssh.resetFingerprint")}
              </VaultButton>
            )}
          </>
        )}

        {entry.type === "api_token" && (
          <>
            <PlainField label={t("entry.service")} value={entry.service} />
            {entry.has_token && (
              <SecureField
                entryId={entry.id}
                field="token"
                label={t("entry.apiToken")}
                copyFieldId={`${prefix}-token`}
                copyLabel={getLabel(`${prefix}-token`)}
                copied={isCopied(`${prefix}-token`)}
                onCopy={() => runAsync(() => copySecret(`${prefix}-token`, entry.id, "token"))}
              />
            )}
          </>
        )}

        {entry.type === "database" && (
          <>
            <PlainField label={t("entry.hostIp")} value={entry.host} />
            <div className="grid grid-cols-2 gap-3">
              <PlainField label={t("entry.port")} value={String(entry.port)} />
              <PlainField label={t("entry.dbType")} value={getDbTypeLabel(entry.db_type)} />
            </div>
            <PlainField label={t("entry.database")} value={entry.database_name} />
            <PlainField
              label={t("entry.username")}
              value={entry.username}
              copyable
              copyLabel={getLabel(`${prefix}-username`)}
              copied={isCopied(`${prefix}-username`)}
              onCopy={() => runAsync(() => copy(`${prefix}-username`, entry.username))}
            />
            {entry.has_password && (
              <SecureField
                entryId={entry.id}
                field="password"
                label={t("entry.password")}
                copyFieldId={`${prefix}-password`}
                copyLabel={getLabel(`${prefix}-password`)}
                copied={isCopied(`${prefix}-password`)}
                onCopy={() =>
                  runAsync(() => copySecret(`${prefix}-password`, entry.id, "password"))
                }
              />
            )}
          </>
        )}

        {entry.type === "network_wifi" && (
          <>
            <PlainField label={t("entry.ssid")} value={entry.ssid} />
            <PlainField
              label={t("entry.encryption")}
              value={getWifiEncryptionLabel(entry.encryption_type)}
            />
            {entry.has_password && (
              <SecureField
                entryId={entry.id}
                field="password"
                label={t("entry.passwordKey")}
                copyFieldId={`${prefix}-password`}
                copyLabel={getLabel(`${prefix}-password`)}
                copied={isCopied(`${prefix}-password`)}
                onCopy={() =>
                  runAsync(() => copySecret(`${prefix}-password`, entry.id, "password"))
                }
              />
            )}
          </>
        )}

        {entry.type === "secure_note" && entry.has_content && (
          <SecureField
            entryId={entry.id}
            field="content"
            label={t("entry.content")}
            multiline
            copyFieldId={`${prefix}-content`}
            copyLabel={getLabel(`${prefix}-content`)}
            copied={isCopied(`${prefix}-content`)}
            onCopy={() => runAsync(() => copySecret(`${prefix}-content`, entry.id, "content"))}
          />
        )}

        </div>
      </div>
    </div>
    </div>
  );
}

function PlainField({
  label,
  value,
  copyable,
  copyLabel,
  copied,
  onCopy,
}: Readonly<{
  label: string;
  value: string;
  copyable?: boolean;
  copyLabel?: string;
  copied?: boolean;
  onCopy?: () => void;
}>) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1.5">
      <span className={UI.fieldLabel}>{label}</span>
      <div className="flex items-center gap-2">
        <div className="flex-1 truncate border-l-2 border-vault-border py-1 pl-3 font-mono text-sm text-vault-text">
          {value}
        </div>
        {copyable && onCopy ? (
          <button
            type="button"
            onClick={onCopy}
            title={copyLabel ?? t("copy.copy")}
            className={`${UI.btnGhost} shrink-0 px-2 py-1 text-xs transition-colors duration-150 ${
              copied ? "text-vault-success" : ""
            }`}
          >
            {copied ? "✓" : (copyLabel ?? t("copy.copy"))}
          </button>
        ) : null}
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
  copied,
  onCopy,
  revealOnly,
}: Readonly<{
  entryId: string;
  field: SecretField;
  label: string;
  multiline?: boolean;
  copyFieldId?: string;
  copyLabel?: string;
  copied?: boolean;
  onCopy?: () => void;
  revealOnly?: boolean;
}>) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const toggleLabel = revealToggleLabel(
    loading,
    revealed !== null,
    "…",
    t("entry.hide"),
    t("entry.reveal"),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span className={UI.fieldLabel}>{label}</span>
      <div className="flex items-start gap-2">
        {multiline ? (
          <pre
            className={`max-h-96 flex-1 overflow-auto whitespace-pre-wrap break-all border-l-2 py-1.5 pl-3 font-mono text-sm transition-colors duration-200 ${
              revealed !== null
                ? "border-vault-accent text-vault-text"
                : "border-vault-border text-vault-muted"
            }`}
          >
            {display}
          </pre>
        ) : (
          <div
            className={`flex-1 truncate border-l-2 py-1 pl-3 font-mono text-sm transition-colors duration-200 ${
              revealed !== null
                ? "border-vault-accent text-vault-text"
                : "border-vault-border tracking-widest text-vault-muted"
            }`}
          >
            {display}
          </div>
        )}
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => runAsync(handleReveal)}
            disabled={loading}
            className={`${UI.btnGhost} px-2 py-1 text-xs disabled:opacity-50 ${revealed !== null ? "text-vault-accent" : ""}`}
          >
            {toggleLabel}
          </button>
          {onCopy && copyFieldId && !revealOnly ? (
            <button
              type="button"
              onClick={onCopy}
              title={copyLabel ?? t("copy.copy")}
              className={`${UI.btnGhost} px-2 py-1 text-xs transition-colors duration-150 ${copied ? "text-vault-success" : ""}`}
            >
              {copied ? "✓" : (copyLabel ?? t("copy.copy"))}
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p className="font-mono text-xs text-vault-danger">{error}</p> : null}
    </div>
  );
}
