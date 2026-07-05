// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import type { Icon } from "@phosphor-icons/react";

interface SidebarNavTabProps {
  readonly label: string;
  readonly icon: Icon;
  readonly active: boolean;
  readonly onClick: () => void;
}

export function SidebarNavTab({ label, icon: Icon, active, onClick }: Readonly<SidebarNavTabProps>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-1.5 px-3 py-2.5 text-sm transition-all duration-150 ${
        active
          ? "font-medium text-vault-accent after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:rounded-t-sm after:bg-vault-accent"
          : "text-vault-muted hover:text-vault-text"
      }`}
      style={active ? { background: "color-mix(in srgb, var(--color-vault-accent) 6%, transparent)" } : undefined}
    >
      <Icon size={15} weight="light" aria-hidden />
      <span>{label}</span>
    </button>
  );
}
