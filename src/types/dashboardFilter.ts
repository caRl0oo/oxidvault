import { getDashboardFilterLabel } from "@/lib/vaultLabels";
import type { SecurityAuditReport } from "@/types/audit";

export type DashboardFilterKind = "weak" | "duplicate" | "expiring";

export interface DashboardFilter {
  kind: DashboardFilterKind;
  entryIds: string[];
  label: string;
}

export function buildDashboardFilter(
  kind: DashboardFilterKind,
  report: SecurityAuditReport,
): DashboardFilter | null {
  let entryIds: string[] = [];
  switch (kind) {
    case "weak":
      entryIds = report.weakEntries.map((e) => e.entryId);
      break;
    case "duplicate":
      entryIds = report.duplicateGroups.flatMap((g) => g.entryIds);
      break;
    case "expiring":
      entryIds = report.expiringEntries.map((e) => e.entryId);
      break;
  }
  if (entryIds.length === 0) return null;
  return {
    kind,
    entryIds: [...new Set(entryIds)],
    label: getDashboardFilterLabel(kind),
  };
}
