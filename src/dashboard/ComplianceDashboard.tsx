// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotationDialog } from "@/components/RotationDialog";
import { Toast } from "@/components/ui/Toast";
import { getComplianceStatus } from "@/lib/ipc";
import { formatVaultError } from "@/lib/errors";
import { runAsync } from "@/lib/runAsync";
import {
  KEY_ROTATION_THRESHOLD_DAYS,
  type ComplianceStatus,
} from "@/types/compliance";

function formatComplianceDate(iso: string | null, dash: string): string {
  if (!iso) {
    return dash;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function isComplianceOk(status: ComplianceStatus): boolean {
  const auditAuthenticated =
    status.auditChainAuthenticated === null || status.auditChainAuthenticated;
  return (
    status.auditChainValid &&
    auditAuthenticated &&
    !status.keyRotationRecommended &&
    !status.legacyFormatMigrationRecommended
  );
}

function auditAuthenticationLabel(
  status: ComplianceStatus,
  translate: (key: string) => string,
): string {
  if (status.auditChainAuthenticated === null) {
    return translate("compliance.audit_auth_locked");
  }
  if (status.auditAuthenticationStatus === "audit_no_checkpoints") {
    return translate("diagnostics.statusCodes.audit_no_checkpoints");
  }
  return status.auditChainAuthenticated ? translate("common.yes") : translate("common.no");
}

function keyAgeClass(recommended: boolean): string {
  return recommended ? "text-vault-danger" : "text-vault-success";
}

export function ComplianceDashboard({
  onOpenMigrateModal,
}: Readonly<{
  onOpenMigrateModal?: () => void;
}>) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ComplianceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rotationOpen, setRotationOpen] = useState(false);
  const [showRotationToast, setShowRotationToast] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getComplianceStatus();
      setStatus(result);
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runAsync(refresh);
  }, [refresh]);

  useEffect(() => {
    if (!showRotationToast) {
      return;
    }
    const timer = globalThis.setTimeout(() => setShowRotationToast(false), 6000);
    return () => globalThis.clearTimeout(timer);
  }, [showRotationToast]);

  const handleRotationSuccess = useCallback(() => {
    setShowRotationToast(true);
    runAsync(refresh);
  }, [refresh]);

  const statusLabel = (ok: boolean) => (ok ? t("common.yes") : t("common.no"));
  const statusClass = (ok: boolean) => (ok ? "text-vault-success" : "text-vault-danger");
  const dash = t("common.dash");

  const renderBody = () => {
    if (loading && !status) {
      return <p className="font-mono text-xs text-vault-muted">{t("compliance.loading")}</p>;
    }

    if (error && !status) {
      return <p className="font-mono text-xs text-vault-danger">{error}</p>;
    }

    if (!status) {
      return null;
    }

    const complianceOk = isComplianceOk(status);

    return (
      <>
        <div
          className={`mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${
            complianceOk
              ? "bg-vault-success-subtle text-vault-success"
              : "bg-vault-danger-subtle text-vault-danger"
          }`}
        >
          <span aria-hidden="true">{complianceOk ? "✓" : "✗"}</span>
          {complianceOk ? t("compliance.compliance_ok") : t("compliance.action_required")}
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ComplianceCard
            label={t("compliance.policy_status")}
            description={t("compliance.gpo_managed")}
            value={statusLabel(status.policyManagedByGpo)}
            ok={status.policyManagedByGpo}
          />
          <ComplianceCard
            label={t("compliance.audit_status")}
            description={t("compliance.hash_chain_valid")}
            value={statusLabel(status.auditChainValid)}
            ok={status.auditChainValid}
          />
          <ComplianceCard
            label={t("compliance.audit_status")}
            description={t("compliance.audit_hmac_valid")}
            value={auditAuthenticationLabel(status, t)}
            ok={status.auditChainAuthenticated ?? null}
          />
          <ComplianceCard
            label={t("compliance.key_age")}
            description={t("compliance.last_rotated", {
              date: formatComplianceDate(status.keyRotatedAt, dash),
            })}
            value={t("compliance.key_age_days", { days: status.keyAgeDays })}
            ok={!status.keyRotationRecommended}
            meta={t("compliance.created", {
              date: formatComplianceDate(status.keyCreatedAt, dash),
            })}
          />
        </div>

        {status.legacyFormatMigrationRecommended ? (
          <div className="mt-4 rounded border border-vault-accent/30 bg-vault-accent/5 p-4">
            <p className="text-sm text-vault-accent">
              {t("compliance.legacy_format_hint", { version: status.vaultFormatVersion })}
            </p>
            <button
              type="button"
              onClick={onOpenMigrateModal}
              disabled={!onOpenMigrateModal}
              className="vault-btn-primary mt-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("compliance.migrate_to_v3")}
            </button>
            <p className="mt-2 text-xs leading-relaxed text-vault-muted">
              {t("compliance.legacy_format_migration_note")}
            </p>
          </div>
        ) : null}

        {status.keyRotationRecommended ? (
          <div className="mt-4 rounded border border-vault-accent/30 bg-vault-accent/5 p-4">
            <p className="text-sm text-vault-accent">
              {t("compliance.rotation_recommended", { days: KEY_ROTATION_THRESHOLD_DAYS })}
            </p>
            <button
              type="button"
              onClick={() => setRotationOpen(true)}
              className="vault-btn-primary mt-3 text-sm"
            >
              {t("compliance.rotate_password")}
            </button>
            <p className="mt-2 text-xs leading-relaxed text-vault-muted">
              {t("compliance.rotation_hint")}
            </p>
          </div>
        ) : null}
      </>
    );
  };

  return (
    <section className="relative w-full shrink-0 border-b border-vault-border px-6 py-4" style={{ backgroundColor: "var(--color-vault-surface)" }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="vault-title text-base">{t("compliance.title")}</h2>
          <p className="vault-subtitle mt-0.5 text-xs">{t("compliance.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => runAsync(refresh)}
          disabled={loading}
          className="vault-btn-secondary shrink-0 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {t("common.refresh")}
        </button>
      </div>

      {renderBody()}

      <RotationDialog
        open={rotationOpen}
        onClose={() => setRotationOpen(false)}
        onSuccess={handleRotationSuccess}
      />

      {showRotationToast ? (
        <Toast tone="success">{t("compliance.rotation_success_toast")}</Toast>
      ) : null}
    </section>
  );
}

function ComplianceCard({
  label,
  description,
  value,
  ok,
  meta,
}: Readonly<{
  label: string;
  description: string;
  value: string;
  ok: boolean | null;
  meta?: string;
}>) {
  const borderColor =
    ok === true
      ? "var(--color-vault-success)"
      : ok === false
        ? "var(--color-vault-danger)"
        : "var(--color-vault-border)";

  const valueClass =
    ok === true
      ? "text-vault-success"
      : ok === false
        ? "text-vault-danger"
        : "text-vault-muted";

  return (
    <div
      className="flex flex-col gap-2 rounded-md border p-4"
      style={{
        backgroundColor: "var(--color-vault-elevated)",
        borderColor: "var(--color-vault-border)",
        borderLeftWidth: "2px",
        borderLeftColor: borderColor,
        boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
      }}
    >
      <span
        className="text-[10px] font-medium uppercase tracking-wider text-vault-muted"
        style={{ letterSpacing: "0.08em" }}
      >
        {label}
      </span>
      <span className="text-sm text-vault-text">{description}</span>
      {meta ? <span className="font-mono text-[11px] text-vault-muted">{meta}</span> : null}
      <span className={`font-mono text-sm font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}
