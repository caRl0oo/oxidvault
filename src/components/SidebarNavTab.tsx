// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import type { LucideIcon } from "lucide-react";

interface SidebarNavTabProps {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly active: boolean;
  readonly onClick: () => void;
}

export function SidebarNavTab({ label, icon: Icon, active, onClick }: Readonly<SidebarNavTabProps>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-all duration-150 ${
        active
          ? "border-vault-accent font-medium text-vault-accent"
          : "border-transparent text-vault-muted hover:text-vault-text"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
      <span>{label}</span>
    </button>
  );
}
