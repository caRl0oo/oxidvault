import { useCallback, useEffect, useState } from "react";
import { RotationDialog } from "@/components/RotationDialog";
import { getComplianceStatus } from "@/lib/ipc";
import { formatVaultError } from "@/lib/errors";
import type { ComplianceStatus } from "@/types/compliance";

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

export function ComplianceDashboard() {
  const [status, setStatus] = useState<ComplianceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rotationOpen, setRotationOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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

  const handleRotationSuccess = useCallback(() => {
    setSuccessMessage("Master-Passwort erfolgreich rotiert. Key-Age wurde zurückgesetzt.");
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

    return (
      <>
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
              Erstellt: {formatComplianceDate(status.keyCreatedAt)} · {status.keyAgeDays} Tage
            </p>
          </article>
        </div>

        {status.keyRotationRecommended ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="font-mono text-xs text-vault-accent">
              Ihre Sicherheitsrichtlinie empfiehlt eine Passwort-Rotation.
            </p>
            <button
              type="button"
              onClick={() => setRotationOpen(true)}
              className="rounded border border-vault-accent px-3 py-1 font-mono text-xs text-vault-accent hover:bg-vault-accent/10"
            >
              Jetzt rotieren
            </button>
          </div>
        ) : null}
      </>
    );
  };

  return (
    <section className="border-b border-vault-border bg-vault-surface/30 px-6 py-4">
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

      {successMessage ? (
        <div className="border-b border-vault-border px-6 py-2">
          <p className="font-mono text-xs text-vault-success">{successMessage}</p>
        </div>
      ) : null}

      {renderBody()}

      <RotationDialog
        open={rotationOpen}
        onClose={() => setRotationOpen(false)}
        onSuccess={handleRotationSuccess}
      />
    </section>
  );
}
