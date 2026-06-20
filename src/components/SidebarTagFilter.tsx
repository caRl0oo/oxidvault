import { useState } from "react";
import { collectUniqueTags } from "@/lib/tags";
import type { SecretEntrySummary } from "@/types/vault";

interface SidebarTagFilterProps {
  entries: SecretEntrySummary[];
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
}

export function SidebarTagFilter({ entries, activeTag, onTagChange }: SidebarTagFilterProps) {
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
        <span>Tags</span>
        <span className="text-[9px]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="flex flex-wrap gap-1 px-0.5">
          <TagBadge
            label="Alle"
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
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition ${
        active
          ? "border-vault-tag bg-vault-tag/25 text-vault-tag"
          : "border-vault-border text-vault-muted hover:border-vault-tag/50 hover:text-vault-tag"
      }`}
    >
      {label}
    </button>
  );
}
