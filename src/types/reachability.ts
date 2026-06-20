export type ReachabilityStatus = "checking" | "online" | "offline" | "unsupported";

export interface ReachabilityState {
  status: ReachabilityStatus;
  host?: string;
  port?: number;
}

export interface EntryReachabilityResult {
  entryId: string;
  status: ReachabilityStatus;
  host?: string;
  port?: number;
  error?: string;
}
