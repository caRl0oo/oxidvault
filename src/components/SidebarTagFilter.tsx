// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { collectUniqueTags } from "@/lib/tags";
import type { SecretEntrySummary } from "@/types/vault";

interface SidebarTagFilterProps {
  entries: SecretEntrySummary[];
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
}

export function SidebarTagFilter({
  entries,
  activeTag,
  onTagChange,
}: Readonly<SidebarTagFilterProps>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const tags = collectUniqueTags(entries);

  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-vault-border px-2 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1.5 flex w-full items-center justify-between px-1 font-mono text-[10px] uppercase tracking-wider text-vault-muted hover:text-vault-text"
      >
        <span>{t("common.tags")}</span>
        <span className="text-[9px]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="flex flex-wrap gap-1 px-0.5">
          <TagBadge
            label={t("common.all")}
            active={activeTag === null}
            onClick={() => onTagChange(null)}
          />
          {tags.map((tag) => (
            <TagBadge
              key={tag}
              label={tag}
              active={activeTag?.toLowerCase() === tag.toLowerCase()}
              onClick={() => onTagChange(tag)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TagBadge({
  label,
  active,
  onClick,
}: Readonly<{
  label: string;
  active: boolean;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-150 ${
        active
          ? "bg-vault-accent text-vault-on-accent"
          : "border border-vault-border bg-vault-bg text-vault-muted hover:border-vault-border-focus hover:text-vault-text"
      }`}
    >
      {label}
    </button>
  );
}
