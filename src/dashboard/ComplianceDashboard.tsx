import { useCallback, useEffect, useState } from "react";
import { RotationDialog } from "@/components/RotationDialog";
import { getComplianceStatus } from "@/lib/ipc";
import { formatVaultError } from "@/lib/errors";
import {
  KEY_ROTATION_THRESHOLD_DAYS,
  type ComplianceStatus,
} from "@/types/compliance";

const ROTATION_SUCCESS_TOAST =
  "Schlüssel erfolgreich rotiert. Ihr Tresor ist nun mit dem neuen Master-Schlüssel geschützt.";

const ROTATION_HINT =
  "Die Rotation erfolgt per sicherer Key-Migration (v2-Format), ohne dass Daten entschlüsselt werden.";

function formatComplianceDate(iso: string | null): string {
  if (!iso) {
    return "—";
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

function statusLabel(ok: boolean): string {
  return ok ? "Ja" : "Nein";
}

function statusClass(ok: boolean): string {
  return ok ? "text-vault-success" : "text-vault-danger";
}

function isComplianceOk(status: ComplianceStatus): boolean {
  return status.auditChainValid && !status.keyRotationRecommended;
}

function keyAgeClass(recommended: boolean): string {
  return recommended ? "text-vault-danger" : "text-vault-success";
}

export function ComplianceDashboard() {
  const [status, setStatus] = useState<ComplianceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rotationOpen, setRotationOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }
    const timer = globalThis.setTimeout(() => setToastMessage(null), 6000);
    return () => globalThis.clearTimeout(timer);
  }, [toastMessage]);

  const handleRotationSuccess = useCallback(() => {
    setToastMessage(ROTATION_SUCCESS_TOAST);
    void refresh();
  }, [refresh]);

  const renderBody = () => {
    if (loading && !status) {
      return (
        <p className="font-mono text-xs text-vault-muted">Lade Compliance-Status…</p>
      );
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
          {complianceOk ? "Compliance OK" : "Handlungsbedarf"}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <article className="rounded border border-vault-border bg-vault-bg px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
              Policy-Status
            </p>
            <p className="mt-2 font-mono text-sm text-vault-text">GPO verwaltet?</p>
            <p
              className={`mt-1 font-mono text-sm font-semibold ${statusClass(status.policyManagedByGpo)}`}
            >
              {statusLabel(status.policyManagedByGpo)}
            </p>
          </article>

          <article className="rounded border border-vault-border bg-vault-bg px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
              Audit-Status
            </p>
            <p className="mt-2 font-mono text-sm text-vault-text">Hash-Kette valide?</p>
            <p
              className={`mt-1 font-mono text-sm font-semibold ${statusClass(status.auditChainValid)}`}
            >
              {statusLabel(status.auditChainValid)}
            </p>
          </article>

          <article className="rounded border border-vault-border bg-vault-bg px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
              Key-Age
            </p>
            <p className="mt-2 font-mono text-sm text-vault-text">
              Zuletzt rotiert: {formatComplianceDate(status.keyRotatedAt)}
            </p>
            <p className="mt-1 font-mono text-xs text-vault-muted">
              Erstellt: {formatComplianceDate(status.keyCreatedAt)}
            </p>
            <p
              className={`mt-1 font-mono text-sm font-semibold ${keyAgeClass(status.keyRotationRecommended)}`}
            >
              Key-Age: {status.keyAgeDays} Tage
            </p>
          </article>
        </div>

        {status.keyRotationRecommended ? (
          <div className="mt-4 rounded border border-vault-accent/30 bg-vault-accent/5 p-4">
            <p className="font-mono text-xs text-vault-accent">
              Ihre Sicherheitsrichtlinie empfiehlt eine Passwort-Rotation (Schwellwert:{" "}
              {KEY_ROTATION_THRESHOLD_DAYS} Tage).
            </p>
            <button
              type="button"
              onClick={() => setRotationOpen(true)}
              className="mt-3 rounded bg-vault-accent px-4 py-2 font-mono text-xs font-semibold text-white hover:bg-vault-accent-hover"
            >
              Passwort rotieren
            </button>
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-vault-muted">
              {ROTATION_HINT}
            </p>
          </div>
        ) : null}
      </>
    );
  };

  return (
    <section className="relative border-b border-vault-border bg-vault-surface/30 px-6 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-vault-text">
            Compliance-Übersicht
          </h2>
          <p className="mt-1 font-mono text-[11px] text-vault-muted">
            Policy-, Audit- und Schlüssel-Status für Enterprise v1.0
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="shrink-0 rounded border border-vault-border px-3 py-1.5 font-mono text-xs text-vault-muted hover:text-vault-text disabled:opacity-50"
        >
          Aktualisieren
        </button>
      </div>

      {renderBody()}

      <RotationDialog
        open={rotationOpen}
        onClose={() => setRotationOpen(false)}
        onSuccess={handleRotationSuccess}
      />

      {toastMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-10 left-1/2 z-[100] max-w-md -translate-x-1/2 rounded-lg border border-vault-success/40 bg-vault-surface px-4 py-3 shadow-lg"
        >
          <p className="font-mono text-xs text-vault-success">{toastMessage}</p>
        </div>
      ) : null}
    </section>
  );
}
