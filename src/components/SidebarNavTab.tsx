interface SidebarNavTabProps {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}

export function SidebarNavTab({ label, active, onClick }: Readonly<SidebarNavTabProps>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded px-2 py-1.5 font-mono text-[11px] transition ${
        active
          ? "bg-vault-accent/20 text-vault-text"
          : "text-vault-muted hover:bg-vault-border/50 hover:text-vault-text"
      }`}
    >
      {label}
    </button>
  );
}
