// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { SidebarEntryItem } from "@/components/SidebarEntryItem";
import { groupEntriesByFolder, shouldGroupByFolder } from "@/lib/tags";
import { UI } from "@/lib/uiClasses";
import type { ReachabilityState } from "@/types/reachability";
import type { SecretEntrySummary } from "@/types/vault";

interface SidebarEntryListProps {
  entries: SecretEntrySummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCopyPassword?: (entryId: string) => void;
  onOpenWebsite?: (entry: SecretEntrySummary) => void;
  onQuickConnect?: (entryId: string) => void;
  sshConnecting?: boolean;
  copyingId?: string | null;
  reachability: Record<string, ReachabilityState>;
}

export function SidebarEntryList({
  entries,
  selectedId,
  onSelect,
  onCopyPassword,
  onOpenWebsite,
  onQuickConnect,
  sshConnecting,
  copyingId,
  reachability,
}: Readonly<SidebarEntryListProps>) {
  const groupByFolder = shouldGroupByFolder(entries);

  if (!groupByFolder) {
    return (
      <>
        {entries.map((entry) => (
          <SidebarEntryItem
            key={entry.id}
            entry={entry}
            selected={selectedId === entry.id}
            onSelect={() => onSelect(entry.id)}
            onCopyPassword={onCopyPassword}
            onOpenWebsite={onOpenWebsite}
            onQuickConnect={onQuickConnect}
            sshConnecting={sshConnecting}
            copyingId={copyingId}
            reachability={reachability[entry.id]}
          />
        ))}
      </>
    );
  }

  const groups = groupEntriesByFolder(entries);
  return (
    <>
      {groups.map((group) => (
        <FolderSection key={group.folder} folder={group.folder}>
          {group.entries.map((entry) => (
            <SidebarEntryItem
              key={entry.id}
              entry={entry}
              selected={selectedId === entry.id}
              onSelect={() => onSelect(entry.id)}
              onCopyPassword={onCopyPassword}
              onOpenWebsite={onOpenWebsite}
              onQuickConnect={onQuickConnect}
              sshConnecting={sshConnecting}
              copyingId={copyingId}
              reachability={reachability[entry.id]}
            />
          ))}
        </FolderSection>
      ))}
    </>
  );
}

function FolderSection({
  folder,
  children,
}: Readonly<{ folder: string; children: React.ReactNode }>) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1 flex w-full items-center gap-1"
      >
        <span className="text-[9px] text-vault-muted" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className={`${UI.sectionLabel} flex-1 truncate text-left normal-case`}>{folder}</span>
      </button>
      {open ? <div>{children}</div> : null}
    </div>
  );
}
