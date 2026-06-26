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
          className={`mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${
            complianceOk
              ? "bg-vault-success-subtle text-vault-success"
              : "bg-vault-danger-subtle text-vault-danger"
          }`}
        >
          <span aria-hidden="true">{complianceOk ? "✓" : "✗"}</span>
          {complianceOk ? t("compliance.compliance_ok") : t("compliance.action_required")}
        </div>

        <div className="mb-6 grid grid-cols-3 gap-3">
          <div className="vault-card flex flex-col gap-2">
            <span className="vault-field-label">{t("compliance.policy_status")}</span>
            <span className="text-sm text-vault-text">{t("compliance.gpo_managed")}</span>
            <span
              className={`text-sm font-semibold ${statusClass(status.policyManagedByGpo)}`}
            >
              {statusLabel(status.policyManagedByGpo)}
            </span>
          </div>

          <div className="vault-card flex flex-col gap-2">
            <span className="vault-field-label">{t("compliance.audit_status")}</span>
            <span className="text-sm text-vault-text">{t("compliance.hash_chain_valid")}</span>
            <span className={`text-sm font-semibold ${statusClass(status.auditChainValid)}`}>
              {statusLabel(status.auditChainValid)}
            </span>
          </div>

          <div className="vault-card flex flex-col gap-2">
            <span className="vault-field-label">{t("compliance.key_age")}</span>
            <span className="text-sm text-vault-text">
              {t("compliance.last_rotated", {
                date: formatComplianceDate(status.keyRotatedAt, dash),
              })}
            </span>
            <span className="text-xs text-vault-muted">
              {t("compliance.created", {
                date: formatComplianceDate(status.keyCreatedAt, dash),
              })}
            </span>
            <span
              className={`text-sm font-semibold ${keyAgeClass(status.keyRotationRecommended)}`}
            >
              {t("compliance.key_age_days", { days: status.keyAgeDays })}
            </span>
          </div>
        </div>

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
    <section className="relative w-full shrink-0 border-b border-vault-border bg-vault-surface/30 px-6 py-4">
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
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-10 left-1/2 z-[100] -translate-x-1/2 rounded-lg border border-vault-success/40 bg-vault-surface px-4 py-3 shadow-lg"
        >
          <p className="font-mono text-xs text-vault-success">
            {t("compliance.rotation_success_toast")}
          </p>
        </div>
      ) : null}
    </section>
  );
}
