import type { SecretEntrySummary } from "@/types/vault";
import { getSecretTypeLabel } from "@/lib/vaultLabels";
import { filterEntriesByTag } from "@/lib/tags";
import type { DashboardFilter } from "@/types/dashboardFilter";

/** Normalize query: lowercase, trim, collapse whitespace. */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Match entry against search query.
 * Searches: title, folder, tags, URL/host/service (subtitle), username, type label.
 */
export function entryMatchesSearch(entry: SecretEntrySummary, rawQuery: string): boolean {
  const q = normalizeSearchQuery(rawQuery);
  if (!q) return true;

  const haystack = [
    entry.title,
    entry.folder,
    ...(entry.tags ?? []),
    entry.subtitle,
    entry.username,
    getSecretTypeLabel(entry.entry_type),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return q.split(" ").every((token) => haystack.includes(token));
}

export function filterEntries(
  entries: SecretEntrySummary[],
  query: string,
  activeTag: string | null = null,
  dashboardFilter: DashboardFilter | null = null,
): SecretEntrySummary[] {
  const byTag = filterEntriesByTag(entries, activeTag);
  const bySearch = byTag.filter((e) => entryMatchesSearch(e, query));
  if (!dashboardFilter) return bySearch;
  const allowed = new Set(dashboardFilter.entryIds);
  return bySearch.filter((e) => allowed.has(e.id));
}
