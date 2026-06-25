import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ClipboardCopy,
  Eye,
  FolderLock,
  GitBranch,
  KeyRound,
  Lock,
  Pencil,
  Settings,
  ShieldAlert,
  Trash2,
  Unlock,
} from "lucide-react";

export type AuditActionTone = "danger" | "accent" | "success" | "config" | "neutral";

export interface AuditActionVisual {
  readonly icon: LucideIcon;
  readonly tone: AuditActionTone;
}

const ACTION_VISUALS: Record<string, AuditActionVisual> = {
  VaultCreated: { icon: FolderLock, tone: "neutral" },
  VaultOpened: { icon: Unlock, tone: "neutral" },
  VaultUnlocked: { icon: Unlock, tone: "success" },
  VaultLocked: { icon: Lock, tone: "neutral" },
  EntryCreated: { icon: FolderLock, tone: "success" },
  EntryUpdated: { icon: Pencil, tone: "neutral" },
  SecretCreated: { icon: FolderLock, tone: "success" },
  SecretModified: { icon: Pencil, tone: "neutral" },
  EntryDeleted: { icon: Trash2, tone: "danger" },
  SecretCopied: { icon: ClipboardCopy, tone: "neutral" },
  SecretRevealed: { icon: Eye, tone: "neutral" },
  VaultKeyRotated: { icon: KeyRound, tone: "config" },
  AuthFailed: { icon: ShieldAlert, tone: "danger" },
  SyncEvent: { icon: GitBranch, tone: "accent" },
  ConfigChanged: { icon: Settings, tone: "config" },
  SshHostTrusted: { icon: ShieldAlert, tone: "success" },
};

const DEFAULT_VISUAL: AuditActionVisual = {
  icon: AlertTriangle,
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
