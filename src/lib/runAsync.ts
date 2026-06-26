// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

/** Run a promise without floating-promise warnings and without the `void` operator (Sonar S6544). */
export function runAsync(
  task: () => Promise<unknown>,
  onError?: (error: unknown) => void,
): void {
  task().catch((error: unknown) => {
    if (onError) {
      onError(error);
    }
  });
}
