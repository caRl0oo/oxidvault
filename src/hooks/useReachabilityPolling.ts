import { useCallback, useEffect, useRef, useState } from "react";
import { checkEntriesReachability } from "@/lib/ipc";
import { runAsync } from "@/lib/runAsync";
import type { ReachabilityState, ReachabilityStatus } from "@/types/reachability";
import { isProbeableEntryType } from "@/types/vault";
import type { SecretEntrySummary } from "@/types/vault";

const POLL_INTERVAL_MS = 10_000;

export function useReachabilityPolling(
  entries: SecretEntrySummary[],
  enabled: boolean,
): Record<string, ReachabilityState> {
  const [statuses, setStatuses] = useState<Record<string, ReachabilityState>>({});
  const inFlightRef = useRef(false);

  const probeableIds = entries.filter((e) => isProbeableEntryType(e.entry_type)).map((e) => e.id);
  const probeableKey = probeableIds.join(",");

  const runProbe = useCallback(async (ids: string[]) => {
    if (ids.length === 0 || inFlightRef.current) return;

    inFlightRef.current = true;
    setStatuses((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        next[id] = { status: "checking" };
      }
      return next;
    });

    try {
      const results = await checkEntriesReachability(ids);
      setStatuses((prev) => {
        const next = { ...prev };
        for (const result of results) {
          next[result.entryId] = {
            status: result.status as ReachabilityStatus,
            host: result.host,
            port: result.port,
          };
        }
        return next;
      });
    } catch {
      setStatuses((prev) => {
        const next = { ...prev };
        for (const id of ids) {
          if (next[id]?.status === "checking") {
            next[id] = { status: "offline" };
          }
        }
        return next;
      });
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatuses({});
      return;
    }

    const ids = probeableKey ? probeableKey.split(",") : [];
    if (ids.length === 0) {
      setStatuses({});
      return;
    }

    runAsync(() => runProbe(ids));
    const timer = globalThis.setInterval(() => runAsync(() => runProbe(ids)), POLL_INTERVAL_MS);
    return () => globalThis.clearInterval(timer);
  }, [enabled, probeableKey, runProbe]);

  return statuses;
}
