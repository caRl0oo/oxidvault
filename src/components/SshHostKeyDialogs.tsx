import { useTranslation } from "react-i18next";
import { VaultButton } from "@/components/ui/VaultButton";
import type { SshHostKeyMismatchState, SshPendingHostState } from "@/types/ssh";

interface SshUnknownHostDialogProps {
  readonly pending: SshPendingHostState;
  readonly loading?: boolean;
  readonly onTrust: () => void;
  readonly onReject: () => void;
}

export function SshUnknownHostDialog({
  pending,
  loading = false,
  onTrust,
  onReject,
}: Readonly<SshUnknownHostDialogProps>) {
  const { t } = useTranslation();

  return (
    <dialog
      open
      className="fixed inset-0 z-[80] m-0 flex max-h-none max-w-none items-center justify-center border-0 bg-vault-overlay/80 p-4 backdrop-blur-sm"
      aria-labelledby="ssh-unknown-host-title"
    >
      <div className="w-full max-w-md rounded-lg border border-vault-border bg-vault-surface p-6 shadow-vault-elevated">
        <h2
          id="ssh-unknown-host-title"
          className="font-mono text-sm font-semibold text-vault-warning"
        >
          {t("ssh.unknownHost")}
        </h2>
        <p className="mt-4 font-mono text-xs text-vault-muted">{t("ssh.trustHostExplanation")}</p>
        <dl className="mt-4 space-y-3 font-mono text-xs">
          <div>
            <dt className="text-vault-muted">{t("ssh.hostLabel")}</dt>
            <dd className="mt-1 break-all text-vault-text">{pending.host}</dd>
          </div>
          <div>
            <dt className="text-vault-muted">{t("ssh.fingerprintLabel")}</dt>
            <dd className="mt-1 break-all text-vault-accent">{pending.fingerprint}</dd>
          </div>
        </dl>
        <div className="mt-6 flex justify-end gap-2">
          <VaultButton variant="outline" size="sm" disabled={loading} onClick={onReject}>
            {t("ssh.reject")}
          </VaultButton>
          <VaultButton size="sm" disabled={loading} onClick={onTrust}>
            {loading ? t("common.loading") : t("ssh.trustAndOpen")}
          </VaultButton>
        </div>
      </div>
    </dialog>
  );
}

interface SshHostKeyMismatchDialogProps {
  readonly mismatch: SshHostKeyMismatchState;
  readonly onClose: () => void;
}

export function SshHostKeyMismatchDialog({
  mismatch,
  onClose,
}: Readonly<SshHostKeyMismatchDialogProps>) {
  const { t } = useTranslation();

  return (
    <dialog
      open
      className="fixed inset-0 z-[80] m-0 flex max-h-none max-w-none items-center justify-center border-0 bg-vault-overlay/80 p-4 backdrop-blur-sm"
      aria-labelledby="ssh-host-mismatch-title"
    >
      <div className="w-full max-w-md rounded-lg border border-vault-danger/50 bg-vault-surface p-6 shadow-vault-elevated">
        <h2
          id="ssh-host-mismatch-title"
          className="font-mono text-sm font-semibold text-vault-danger"
        >
          {t("ssh.hostKeyMismatch")}
        </h2>
        <p className="mt-3 font-mono text-xs text-vault-danger">{t("ssh.mitmWarning")}</p>
        <p className="mt-3 font-mono text-xs text-vault-muted">{t("ssh.mismatchInstruction")}</p>
        <dl className="mt-4 space-y-3 font-mono text-xs">
          <div>
            <dt className="text-vault-muted">{t("ssh.expectedFingerprint")}</dt>
            <dd className="mt-1 break-all text-vault-text">{mismatch.expected}</dd>
          </div>
          <div>
            <dt className="text-vault-muted">{t("ssh.receivedFingerprint")}</dt>
            <dd className="mt-1 break-all text-vault-danger">{mismatch.got}</dd>
          </div>
        </dl>
        <div className="mt-6 flex justify-end">
          <VaultButton variant="outline" tone="danger" size="sm" onClick={onClose}>
            {t("common.close")}
          </VaultButton>
        </div>
      </div>
    </dialog>
  );
}
