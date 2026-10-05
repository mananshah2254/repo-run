import type { ProviderFailure } from './types';

// Electron's contextBridge preserves Error.message, but drops custom Error properties.
const marker = 'REPO_RUN_ERROR:';
export function encodeError(error: { message: string } & Partial<ProviderFailure>) {
  return marker + JSON.stringify(error);
}
export function decodeError(error: unknown): { message: string } & Partial<ProviderFailure> {
  const message = error instanceof Error ? error.message : 'The operation could not be completed.';
  const index = message.indexOf(marker);
  if (index >= 0) {
    try {
      const value = JSON.parse(message.slice(index + marker.length));
      if (typeof value.message === 'string')
        return {
          message: value.message,
          code: ['rate-limit', 'authentication', 'forbidden'].includes(value.code)
            ? value.code
            : undefined,
          provider: ['GitHub', 'GitLab'].includes(value.provider) ? value.provider : undefined,
          retryAt:
            Number.isFinite(value.retryAt) && value.retryAt > 0 && value.retryAt <= 8.64e15
              ? value.retryAt
              : undefined,
        };
    } catch {
      /* Fall back to the original message. */
    }
  }
  return { message: message.replace(/^Error invoking remote method '[^']+': Error: /, '') };
}
