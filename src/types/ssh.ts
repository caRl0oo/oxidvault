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

export interface SshTerminalState {
  session: SshSessionInfo;
  entryTitle: string;
}
