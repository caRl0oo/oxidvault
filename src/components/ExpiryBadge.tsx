import { formatExpiryDate, getExpiryStatus } from "@/lib/expiry";
import type { SecretEntryFull } from "@/types/vault";

export function ExpiryBadge({ expiresAt }: { expiresAt?: string | null }) {
  const status = getExpiryStatus(expiresAt);
  if (!status || !expiresAt) return null;

  if (status.kind === "expired") {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 rounded border border-vault-danger/50 bg-vault-danger/10 px-2.5 py-1 font-mono text-[11px] text-vault-danger">
        <span aria-hidden>⚠</span>
        WARNUNG: Passwort abgelaufen!
      </div>
    );
  }

  return (
    <div className="mt-2 inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] text-amber-300">
      <span aria-hidden>⏳</span>
      Läuft am {formatExpiryDate(expiresAt)} ab
      {status.daysRemaining === 0 ? " (heute)" : status.daysRemaining === 1 ? " (morgen)" : ""}
    </div>
  );
}

export function expiryLabel(entry: Pick<SecretEntryFull, "expires_at">): string | null {
  const status = getExpiryStatus(entry.expires_at);
  if (!status || !entry.expires_at) return null;
  if (status.kind === "expired") return "Abgelaufen";
  return `Läuft am ${formatExpiryDate(entry.expires_at)} ab`;
}
