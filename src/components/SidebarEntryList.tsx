import { useState } from "react";
import { SidebarEntryItem } from "@/components/SidebarEntryItem";
import { groupEntriesByFolder, shouldGroupByFolder } from "@/lib/tags";
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
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1 flex w-full items-center gap-1 px-2 font-mono text-[10px] uppercase tracking-wider text-vault-muted hover:text-vault-text"
      >
        <span className="text-[9px]">{open ? "▾" : "▸"}</span>
        <span className="truncate">{folder}</span>
      </button>
      {open && <div className="pl-1">{children}</div>}
    </div>
  );
}
