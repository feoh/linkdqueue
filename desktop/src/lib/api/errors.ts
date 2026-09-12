import type { AppError, ErrorCode, Generation } from './types';

const messages: Record<ErrorCode, string> = {
  invalid_input: 'The request is invalid.',
  invalid_base_url: 'The Linkding URL is invalid.',
  insecure_http: 'HTTP requires explicit local-connection consent.',
  preferences_corrupt: 'Saved desktop settings are corrupt.',
  preferences_write_failed: 'Desktop settings could not be saved.',
  keyring_unavailable: 'Secure credential storage is unavailable.',
  keyring_locked: 'Secure credential storage is locked.',
  credential_missing: 'No saved Linkding credential is available.',
  credential_delete_failed: 'The saved Linkding credential could not be removed.',
  auth_failed: 'Linkding authentication failed.',
  permission_denied: 'Linkding denied this operation.',
  not_found: 'The Linkding resource was not found.',
  bad_request: 'Linkding rejected the request.',
  rate_limited: 'Linkding is rate limiting requests; retry later.',
  server_error: 'The Linkding server failed the request.',
  network_error: 'The Linkding server could not be reached.',
  timeout_unknown_outcome: 'The mutation timed out; reconcile before retrying.',
  stale_generation: 'The connection changed; retry with current settings.',
  external_url_rejected: 'Only safe HTTP and HTTPS URLs can be opened.',
  internal_error: 'The desktop operation failed.',
};

const errorCodes = new Set<ErrorCode>(Object.keys(messages) as ErrorCode[]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function asSafeGeneration(value: unknown): Generation | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function asSafeStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

/**
 * Convert Tauri's unknown rejected invoke payload into the public error DTO.
 * Incoming message text is deliberately discarded so a token or server body
 * can never become a renderer-visible exception.
 */
export function normalizeIpcError(value: unknown): AppError {
  const candidate = isRecord(value) && isRecord(value.error) ? value.error : value;
  if (
    !isRecord(candidate) ||
    typeof candidate.code !== 'string' ||
    !errorCodes.has(candidate.code as ErrorCode)
  ) {
    return { code: 'internal_error', message: messages.internal_error, retryable: false };
  }

  const code = candidate.code as ErrorCode;
  const generation = asSafeGeneration(candidate.generation);
  const status = asSafeStatus(candidate.status);
  return {
    code,
    message: messages[code],
    retryable: code === 'network_error' || code === 'server_error' || code === 'rate_limited',
    ...(status === undefined ? {} : { status }),
    ...(generation === undefined ? {} : { generation }),
  };
}
