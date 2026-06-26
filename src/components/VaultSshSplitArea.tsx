// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { SshTerminalPanel } from "@/components/SshTerminalPanel";
import type { SshSessionStatus, SshTerminalState } from "@/types/ssh";

export interface VaultSshSplitAreaProps {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly vaultPanel: ReactNode;
  readonly sshTerminal: SshTerminalState;
  readonly sshSessionStatus: SshSessionStatus | null;
  readonly sshFocusMode: boolean;
  readonly layoutReady: boolean;
  readonly vaultWidthPx: number | null;
  readonly terminalLayoutKey: string;
  readonly onDividerPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly onToggleSshFocusMode: () => void;
  readonly onCloseSshTerminal: () => void;
  readonly onSshSessionActive: () => void;
  readonly onSshSessionEnded: () => void;
}

export function VaultSshSplitArea({
  containerRef,
  vaultPanel,
  sshTerminal,
  sshSessionStatus,
  sshFocusMode,
  layoutReady,
  vaultWidthPx,
  terminalLayoutKey,
  onDividerPointerDown,
  onToggleSshFocusMode,
  onCloseSshTerminal,
  onSshSessionActive,
  onSshSessionEnded,
}: Readonly<VaultSshSplitAreaProps>) {
  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1 overflow-hidden">
      {sshFocusMode ? null : (
        <VaultSplitPane
          vaultPanel={vaultPanel}
          layoutReady={layoutReady}
          vaultWidthPx={vaultWidthPx}
          onDividerPointerDown={onDividerPointerDown}
        />
      )}
      <SshTerminalShell focusMode={sshFocusMode}>
        <SshTerminalPanel
          state={sshTerminal}
          status={sshSessionStatus ?? "connecting"}
          focusMode={sshFocusMode}
          layoutKey={terminalLayoutKey}
          onToggleFocusMode={onToggleSshFocusMode}
          onClose={onCloseSshTerminal}
          onSessionActive={onSshSessionActive}
          onSessionEnded={onSshSessionEnded}
        />
      </SshTerminalShell>
    </div>
  );
}

interface VaultSplitPaneProps {
  readonly vaultPanel: ReactNode;
  readonly layoutReady: boolean;
  readonly vaultWidthPx: number | null;
  readonly onDividerPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}

function VaultSplitPane({
  vaultPanel,
  layoutReady,
  vaultWidthPx,
  onDividerPointerDown,
}: Readonly<VaultSplitPaneProps>) {
  const { t } = useTranslation();
  const useMeasuredWidth = layoutReady && vaultWidthPx !== null;

  return (
    <>
      {useMeasuredWidth ? (
        <div style={{ width: vaultWidthPx, flex: "0 0 auto" }} className="vault-main-panel">
          {vaultPanel}
        </div>
      ) : (
        <div className="vault-main-panel flex-[0_0_45%]">{vaultPanel}</div>
      )}
      <hr
        aria-orientation="vertical"
        aria-label={t("ssh.resizeDivider")}
        onPointerDown={onDividerPointerDown}
        className="m-0 h-auto w-1 shrink-0 cursor-col-resize border-0 bg-vault-border hover:bg-vault-accent/60 active:bg-vault-accent"
      />
    </>
  );
}

function SshTerminalShell({
  focusMode,
  children,
}: Readonly<{ focusMode: boolean; children: ReactNode }>) {
  const shellClass = focusMode
    ? "absolute inset-0 z-10 flex min-h-0 min-w-0 flex-col border-l border-vault-border bg-vault-bg"
    : "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden";

  return <div className={shellClass}>{children}</div>;
}
