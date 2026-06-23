export interface SshSessionInfo {
  sessionId: string;
  host: string;
  username: string;
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
