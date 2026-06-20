import type { ReachabilityState } from "@/types/reachability";

interface ReachabilityDotProps {
  state?: ReachabilityState;
  size?: "sm" | "md";
}

const SIZE_CLASS = {
  sm: "h-1.5 w-1.5",
  md: "h-2 w-2",
} as const;

export function ReachabilityDot({ state, size = "sm" }: ReachabilityDotProps) {
  if (!state || state.status === "unsupported") {
    return null;
  }

  const title =
    state.status === "checking"
      ? "Prüfe Status…"
      : state.status === "online"
        ? state.host && state.port
          ? `Online · ${state.host}:${state.port}`
          : "Online"
        : state.host && state.port
          ? `Offline · ${state.host}:${state.port}`
          : "Offline";

  const colorClass =
    state.status === "checking"
      ? "bg-vault-muted animate-pulse"
      : state.status === "online"
        ? "bg-vault-success shadow-[0_0_5px_1px] shadow-vault-success/60 animate-pulse"
        : "bg-vault-danger";

  return (
    <span
      className={`inline-block shrink-0 rounded-full ${SIZE_CLASS[size]} ${colorClass}`}
      title={title}
      aria-label={title}
      role="status"
    />
  );
}
