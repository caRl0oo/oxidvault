// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import type { Icon } from "@phosphor-icons/react";
import {
  Warning,
  Copy,
  Eye,
  FolderLock,
  GitBranch,
  Key,
  Lock,
  LockOpen,
  PencilSimple,
  Gear,
  ShieldWarning,
  Trash,
} from "@phosphor-icons/react";

export type AuditActionTone = "danger" | "accent" | "success" | "config" | "neutral";

export interface AuditActionVisual {
  readonly icon: Icon;
  readonly tone: AuditActionTone;
}

const ACTION_VISUALS: Record<string, AuditActionVisual> = {
  VaultCreated: { icon: FolderLock, tone: "neutral" },
  VaultOpened: { icon: LockOpen, tone: "neutral" },
  VaultUnlocked: { icon: LockOpen, tone: "success" },
  VaultLocked: { icon: Lock, tone: "neutral" },
  EntryCreated: { icon: FolderLock, tone: "success" },
  EntryUpdated: { icon: PencilSimple, tone: "neutral" },
  SecretCreated: { icon: FolderLock, tone: "success" },
  SecretModified: { icon: PencilSimple, tone: "neutral" },
  EntryDeleted: { icon: Trash, tone: "danger" },
  SecretCopied: { icon: Copy, tone: "neutral" },
  SecretRevealed: { icon: Eye, tone: "neutral" },
  SecretAutofilled: { icon: Copy, tone: "accent" },
  BridgeThrottled: { icon: ShieldWarning, tone: "danger" },
  VaultKeyRotated: { icon: Key, tone: "config" },
  AuthFailed: { icon: ShieldWarning, tone: "danger" },
  SyncEvent: { icon: GitBranch, tone: "accent" },
  ConfigChanged: { icon: Gear, tone: "config" },
  SshHostTrusted: { icon: ShieldWarning, tone: "success" },
  UserAdded: { icon: FolderLock, tone: "success" },
  UserRemoved: { icon: Trash, tone: "danger" },
  UserPasswordChanged: { icon: Key, tone: "config" },
  UserRoleChanged: { icon: Gear, tone: "config" },
  UserMfaEnabled: { icon: ShieldWarning, tone: "success" },
  UserMfaDisabled: { icon: ShieldWarning, tone: "neutral" },
  VaultMigratedToV3: { icon: FolderLock, tone: "accent" },
};

const DEFAULT_VISUAL: AuditActionVisual = {
  icon: Warning,
  tone: "neutral",
};

export function getAuditActionVisual(action: string): AuditActionVisual {
  return ACTION_VISUALS[action] ?? DEFAULT_VISUAL;
}

export function auditActionToneClass(tone: AuditActionTone): string {
  switch (tone) {
    case "danger":
      return "text-vault-danger";
    case "accent":
      return "text-vault-accent";
    case "success":
      return "text-vault-success";
    case "config":
      return "text-vault-tag";
    default:
      return "text-vault-text";
  }
}

export function auditActionBadgeClass(tone: AuditActionTone): string {
  switch (tone) {
    case "danger":
      return "border-vault-danger/40 bg-vault-danger/10 text-vault-danger";
    case "accent":
      return "border-vault-accent/40 bg-vault-accent/10 text-vault-accent";
    case "success":
      return "border-vault-success/40 bg-vault-success/10 text-vault-success";
    case "config":
      return "border-vault-tag/40 bg-vault-tag/10 text-vault-tag";
    default:
      return "border-vault-border bg-vault-bg text-vault-text";
  }
}
