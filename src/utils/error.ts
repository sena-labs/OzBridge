/**
 * Utility functions for error handling and formatting.
 */

/**
 * Extracts a readable error message from an unknown error value.
 * Handles Error instances, objects with message properties, and other values.
 *
 * @param err - The error value to extract a message from
 * @returns A string representation of the error
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

/**
 * Extracts a detailed error string including stack trace if available.
 *
 * @param err - The error value to format
 * @returns A detailed string representation of the error
 */
export function getErrorDetails(err: unknown): string {
  if (err instanceof Error && err.stack) {
    return err.stack;
  }
  return getErrorMessage(err);
}
