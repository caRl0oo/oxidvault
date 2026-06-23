import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { SSH_SPLIT_LAYOUT } from "@/lib/sshTerminalLayout";

interface UseResizableSplitOptions {
  readonly initialVaultRatio?: number;
  readonly minVaultPx?: number;
  readonly minTerminalPx?: number;
  readonly enabled?: boolean;
}

export function useResizableSplit({
  initialVaultRatio = SSH_SPLIT_LAYOUT.initialVaultRatio,
  minVaultPx = SSH_SPLIT_LAYOUT.minVaultPx,
  minTerminalPx = SSH_SPLIT_LAYOUT.minTerminalPx,
  enabled = true,
}: UseResizableSplitOptions = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [vaultWidthPx, setVaultWidthPx] = useState<number | null>(null);
  const dragging = useRef(false);

  const clampVaultWidth = useCallback(
    (next: number, totalWidth: number) => {
      const divider = SSH_SPLIT_LAYOUT.dividerWidthPx;
      const maxVault = totalWidth - minTerminalPx - divider;
      return Math.round(Math.min(Math.max(next, minVaultPx), Math.max(minVaultPx, maxVault)));
    },
    [minTerminalPx, minVaultPx],
  );

  const initializeWidth = useCallback(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    const total = container.getBoundingClientRect().width;
    if (total <= 0) return;
    setVaultWidthPx((prev) => {
      if (prev !== null) return prev;
      return clampVaultWidth(total * initialVaultRatio, total);
    });
  }, [clampVaultWidth, enabled, initialVaultRatio]);

  useLayoutEffect(() => {
    if (!enabled) {
      setVaultWidthPx(null);
      return;
    }

    initializeWidth();
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      initializeWidth();
      setVaultWidthPx((prev) => {
        if (prev === null) return prev;
        const total = container.getBoundingClientRect().width;
        if (total <= 0) return prev;
        return clampVaultWidth(prev, total);
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [clampVaultWidth, enabled, initializeWidth]);

  const onDividerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      event.preventDefault();
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [enabled],
  );

  useLayoutEffect(() => {
    if (!enabled) return;

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const next = event.clientX - rect.left;
      setVaultWidthPx(clampVaultWidth(next, rect.width));
    };

    const onPointerUp = () => {
      dragging.current = false;
    };

    globalThis.addEventListener("pointermove", onPointerMove);
    globalThis.addEventListener("pointerup", onPointerUp);
    return () => {
      globalThis.removeEventListener("pointermove", onPointerMove);
      globalThis.removeEventListener("pointerup", onPointerUp);
    };
  }, [clampVaultWidth, enabled]);

  return {
    vaultWidthPx,
    containerRef,
    onDividerPointerDown,
    layoutReady: !enabled || vaultWidthPx !== null,
  };
}
