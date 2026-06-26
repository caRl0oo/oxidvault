// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

export const INPUT_FIELD_CLASS =
  "vault-elevated w-full rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm placeholder:text-vault-muted focus:border-vault-accent outline-none";

export const MODAL_DIALOG_CLASS =
  "fixed inset-0 z-[60] m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-vault-overlay p-4 backdrop-blur-sm open:flex";

export const MODAL_PANEL_CLASS =
  "vault-elevated relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border border-vault-border bg-vault-surface shadow-xl";

export const MODAL_FOOTER_CLASS = "flex gap-2 border-t border-vault-border px-5 py-4";

export const BTN_PRIMARY_CLASS =
  "rounded bg-vault-accent font-mono text-vault-on-accent transition hover:bg-vault-accent-hover disabled:opacity-50";

export const BTN_OUTLINE_CLASS =
  "rounded border border-vault-border bg-transparent font-mono text-vault-muted transition hover:border-vault-accent hover:text-vault-accent disabled:opacity-50";

export const BTN_OUTLINE_DANGER_CLASS =
  "rounded border border-vault-danger/50 bg-transparent font-mono text-vault-danger transition hover:bg-vault-danger/10 disabled:opacity-50";

export const BTN_GHOST_CLASS =
  "rounded border border-transparent bg-transparent font-mono text-vault-muted transition hover:bg-vault-hover-overlay hover:text-vault-text disabled:opacity-50";

export const BTN_SECONDARY_CLASS =
  "rounded border border-vault-border px-3 py-1.5 font-mono text-xs text-vault-muted hover:text-vault-text disabled:opacity-50";

export const STATUS_SUCCESS_CLASS =
  "inline-flex items-center gap-1.5 rounded border border-vault-success/40 bg-vault-success/10 font-mono text-vault-success";

export const NOTE_PANEL_CLASS =
  "rounded border border-vault-border bg-vault-bg font-mono text-vault-muted";

export const MFA_LOCKOUT_BANNER_CLASS =
  "rounded border border-vault-danger/40 bg-vault-danger/10 px-3 py-2 font-mono text-xs text-vault-danger";

export const INPUT_FIELD_DISABLED_CLASS =
  "disabled:cursor-not-allowed disabled:opacity-50";

export const CONFIRM_PANEL_CLASS =
  "rounded border border-vault-border bg-vault-bg";
