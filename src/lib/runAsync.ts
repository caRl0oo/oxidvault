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
