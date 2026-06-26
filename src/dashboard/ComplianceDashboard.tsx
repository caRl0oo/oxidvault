// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotationDialog } from "@/components/RotationDialog";
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
  return status.auditChainValid && !status.keyRotationRecommended;
}

function keyAgeClass(recommended: boolean): string {
  return recommended ? "text-vault-danger" : "text-vault-success";
}

export function ComplianceDashboard() {
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
          className={`mb-3 inline-flex items-center gap-2 rounded border px-3 py-1.5 font-mono text-xs ${
            complianceOk
              ? "border-vault-success/40 bg-vault-success/10 text-vault-success"
              : "border-vault-accent/40 bg-vault-accent/10 text-vault-accent"
          }`}
        >
          <span aria-hidden="true">{complianceOk ? "✓" : "!"}</span>
          {complianceOk ? t("compliance.compliance_ok") : t("compliance.action_required")}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <article className="rounded border border-vault-border bg-vault-bg px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
              {t("compliance.policy_status")}
            </p>
            <p className="mt-2 font-mono text-sm text-vault-text">{t("compliance.gpo_managed")}</p>
            <p
              className={`mt-1 font-mono text-sm font-semibold ${statusClass(status.policyManagedByGpo)}`}
            >
              {statusLabel(status.policyManagedByGpo)}
            </p>
          </article>

          <article className="rounded border border-vault-border bg-vault-bg px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
              {t("compliance.audit_status")}
            </p>
            <p className="mt-2 font-mono text-sm text-vault-text">
              {t("compliance.hash_chain_valid")}
            </p>
            <p
              className={`mt-1 font-mono text-sm font-semibold ${statusClass(status.auditChainValid)}`}
            >
              {statusLabel(status.auditChainValid)}
            </p>
          </article>

          <article className="rounded border border-vault-border bg-vault-bg px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
              {t("compliance.key_age")}
            </p>
            <p className="mt-2 font-mono text-sm text-vault-text">
              {t("compliance.last_rotated", {
                date: formatComplianceDate(status.keyRotatedAt, dash),
              })}
            </p>
            <p className="mt-1 font-mono text-xs text-vault-muted">
              {t("compliance.created", {
                date: formatComplianceDate(status.keyCreatedAt, dash),
              })}
            </p>
            <p
              className={`mt-1 font-mono text-sm font-semibold ${keyAgeClass(status.keyRotationRecommended)}`}
            >
              {t("compliance.key_age_days", { days: status.keyAgeDays })}
            </p>
          </article>
        </div>

        {status.keyRotationRecommended ? (
          <div className="mt-4 rounded border border-vault-accent/30 bg-vault-accent/5 p-4">
            <p className="font-mono text-xs text-vault-accent">
              {t("compliance.rotation_recommended", { days: KEY_ROTATION_THRESHOLD_DAYS })}
            </p>
            <button
              type="button"
              onClick={() => setRotationOpen(true)}
              className="mt-3 rounded bg-vault-accent px-4 py-2 font-mono text-xs font-semibold text-vault-on-accent hover:bg-vault-accent-hover"
            >
              {t("compliance.rotate_password")}
            </button>
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-vault-muted">
              {t("compliance.rotation_hint")}
            </p>
          </div>
        ) : null}
      </>
    );
  };

  return (
    <section className="relative shrink-0 border-b border-vault-border bg-vault-surface/30 px-6 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-vault-text">
            {t("compliance.title")}
          </h2>
          <p className="mt-1 font-mono text-[11px] text-vault-muted">{t("compliance.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => runAsync(refresh)}
          disabled={loading}
          className="shrink-0 rounded border border-vault-border px-3 py-1.5 font-mono text-xs text-vault-muted hover:text-vault-text disabled:opacity-50"
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
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-10 left-1/2 z-[100] max-w-md -translate-x-1/2 rounded-lg border border-vault-success/40 bg-vault-surface px-4 py-3 shadow-lg"
        >
          <p className="font-mono text-xs text-vault-success">
            {t("compliance.rotation_success_toast")}
          </p>
        </div>
      ) : null}
    </section>
  );
}
