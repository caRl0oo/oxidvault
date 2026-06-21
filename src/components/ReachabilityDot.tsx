import { useTranslation } from "react-i18next";
import type { ReachabilityState, ReachabilityStatus } from "@/types/reachability";

interface ReachabilityDotProps {
  state?: ReachabilityState;
  size?: "sm" | "md";
}

const SIZE_CLASS = {
  sm: "h-1.5 w-1.5",
  md: "h-2 w-2",
} as const;

function reachabilityTitle(
  state: ReachabilityState,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (state.status === "checking") {
    return translate("reachability.checking");
  }
  if (state.status === "online") {
    if (state.host && state.port) {
      return translate("reachability.onlineHost", { host: state.host, port: state.port });
    }
    return translate("reachability.online");
  }
  if (state.host && state.port) {
    return translate("reachability.offlineHost", { host: state.host, port: state.port });
  }
  return translate("reachability.offline");
}

function reachabilityColorClass(status: ReachabilityStatus): string {
  if (status === "checking") {
    return "bg-vault-muted animate-pulse";
  }
  if (status === "online") {
    return "bg-vault-success shadow-[0_0_5px_1px] shadow-vault-success/60 animate-pulse";
  }
  return "bg-vault-danger";
}

export function ReachabilityDot({ state, size = "sm" }: Readonly<ReachabilityDotProps>) {
  const { t } = useTranslation();

  if (!state || state.status === "unsupported") {
    return null;
  }

  const title = reachabilityTitle(state, t);
  const colorClass = reachabilityColorClass(state.status);

  return (
    <output
      className={`inline-block shrink-0 rounded-full ${SIZE_CLASS[size]} ${colorClass}`}
      title={title}
      aria-label={title}
    />
  );
}
