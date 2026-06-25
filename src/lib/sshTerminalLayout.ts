// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

/** Sidebar width (`w-80`) in the vault workspace layout. */
const SIDEBAR_WIDTH_PX = 320;
const DIVIDER_WIDTH_PX = 4;
const APP_CHROME_PX = 96;
const TERMINAL_CHROME_PX = 72;
const CHAR_WIDTH_PX = 7.8;
const LINE_HEIGHT_PX = 16;

const MIN_COLS = 40;
const MAX_COLS = 300;
const MIN_ROWS = 12;
const MAX_ROWS = 120;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface PtySizeEstimateOptions {
  readonly focusMode?: boolean;
  readonly vaultWidthRatio?: number;
}

/** Estimates PTY dimensions from the current window before the terminal panel mounts. */
export function estimateInitialPtySize(
  options: PtySizeEstimateOptions = {},
): { cols: number; rows: number } {
  const vaultRatio = options.vaultWidthRatio ?? 0.45;
  const mainWidth = Math.max(0, window.innerWidth - SIDEBAR_WIDTH_PX);
  const terminalWidth = options.focusMode
    ? mainWidth
    : mainWidth * (1 - vaultRatio) - DIVIDER_WIDTH_PX;
  const terminalHeight = Math.max(
    0,
    window.innerHeight - APP_CHROME_PX - TERMINAL_CHROME_PX,
  );

  return {
    cols: clamp(Math.floor(terminalWidth / CHAR_WIDTH_PX), MIN_COLS, MAX_COLS),
    rows: clamp(Math.floor(terminalHeight / LINE_HEIGHT_PX), MIN_ROWS, MAX_ROWS),
  };
}

export const SSH_SPLIT_LAYOUT = {
  sidebarWidthPx: SIDEBAR_WIDTH_PX,
  dividerWidthPx: DIVIDER_WIDTH_PX,
  minVaultPx: 280,
  minTerminalPx: 320,
  initialVaultRatio: 0.45,
} as const;
