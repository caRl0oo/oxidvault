// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

/** Raycast-inspired design tokens — global classes from globals.css */
export const UI = {
  input: "vault-input",
  btnPrimary: "vault-btn-primary",
  btnSecondary: "vault-btn-secondary",
  btnDanger: "vault-btn-danger",
  btnGhost: "vault-btn-ghost",
  card: "vault-card",
  fieldLabel: "vault-field-label",
  sectionLabel: "vault-section-label",
  title: "vault-title",
  muted: "vault-subtitle",
} as const;

export const INPUT_FIELD_CLASS = UI.input;

export const MODAL_DIALOG_CLASS =
  "fixed inset-0 z-[60] m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-vault-overlay p-4 backdrop-blur-sm open:flex";

export const MODAL_PANEL_CLASS =
  "vault-elevated relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border border-vault-border bg-vault-surface shadow-xl";

export const MODAL_FOOTER_CLASS = "flex gap-2 border-t border-vault-border px-5 py-4";

export const BTN_PRIMARY_CLASS = UI.btnPrimary;

export const BTN_OUTLINE_CLASS = UI.btnSecondary;

export const BTN_OUTLINE_DANGER_CLASS = UI.btnDanger;

export const BTN_GHOST_CLASS = UI.btnGhost;

export const BTN_SECONDARY_CLASS = `${UI.btnSecondary} px-3 py-1.5 text-xs`;

export const STATUS_SUCCESS_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg border border-vault-success/40 bg-vault-success-subtle font-mono text-vault-success";

export const NOTE_PANEL_CLASS =
  "rounded-lg border border-vault-border bg-vault-bg font-mono text-vault-muted";

export const MFA_LOCKOUT_BANNER_CLASS =
  "rounded-lg border border-vault-danger/40 bg-vault-danger-subtle px-3 py-2 font-mono text-xs text-vault-danger";

export const INPUT_FIELD_DISABLED_CLASS =
  "disabled:cursor-not-allowed disabled:opacity-50";

export const CONFIRM_PANEL_CLASS =
  "rounded-lg border border-vault-border bg-vault-bg";
