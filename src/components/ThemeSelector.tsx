import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { THEME_OPTIONS } from "@/lib/theme";

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = THEME_OPTIONS.find((t) => t.id === theme);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Design auswählen"
        title="Design / Theme"
        className="rounded border border-vault-border p-1.5 text-vault-muted transition hover:border-vault-accent hover:text-vault-accent"
      >
        <GearIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Theme-Auswahl"
          className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-lg border border-vault-border bg-vault-surface shadow-xl"
        >
          <div className="border-b border-vault-border px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
              Design
            </p>
            {current && (
              <p className="mt-0.5 font-mono text-xs text-vault-text">{current.label}</p>
            )}
          </div>
          <ul className="py-1">
            {THEME_OPTIONS.map((option) => {
              const active = option.id === theme;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setTheme(option.id);
                      setOpen(false);
                    }}
                    className={`flex w-full flex-col px-3 py-2 text-left transition ${
                      active
                        ? "bg-vault-accent/15 text-vault-text"
                        : "text-vault-muted hover:bg-vault-border/40 hover:text-vault-text"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-mono text-xs font-medium">
                      <ThemeSwatch themeId={option.id} />
                      {option.label}
                      {active && (
                        <span className="ml-auto text-[10px] text-vault-accent">✓</span>
                      )}
                    </span>
                    <span className="mt-0.5 pl-5 font-mono text-[10px] opacity-70">
                      {option.description}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function ThemeSwatch({ themeId }: { themeId: string }) {
  const colors: Record<string, [string, string]> = {
    oxid: ["#3b82f6", "#12141a"],
    dracula: ["#bd93f9", "#282a36"],
    nord: ["#88c0d0", "#2e3440"],
    matrix: ["#00ff41", "#0d0d0d"],
  };
  const [accent, bg] = colors[themeId] ?? colors.oxid;
  return (
    <span
      className="inline-block h-3 w-3 shrink-0 rounded-full border border-vault-border"
      style={{ background: `linear-gradient(135deg, ${accent} 50%, ${bg} 50%)` }}
      aria-hidden
    />
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
