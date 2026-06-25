// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

export interface SshSessionInfo {
  sessionId: string;
  host: string;
  username: string;
}

export type SshConnectResponse =
  | { status: "connected"; session: SshSessionInfo }
  | {
      status: "unknownHost";
      fingerprint: string;
      sessionId: string;
      host: string;
      username: string;
    }
  | { status: "hostKeyMismatch"; expected: string; got: string };

export interface SshPendingHostState {
  entryId: string;
  entryTitle: string;
  fingerprint: string;
  sessionId: string;
  host: string;
  username: string;
}

export interface SshHostKeyMismatchState {
  expected: string;
  got: string;
}

export interface SshDataEvent {
  sessionId: string;
  data: string;
}

export interface SshClosedEvent {
  sessionId: string;
  error?: string;
}

export type SshSessionStatus = "connecting" | "active" | "disconnected";

export interface SshTerminalState {
  session: SshSessionInfo;
  entryId: string;
  entryTitle: string;
}
