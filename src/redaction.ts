/**
 * Shared redaction rules for everything Pulse stores about a request or an error: header names that carry
 * credentials, object keys that look like secrets, and raw HTTP header blocks (for example the `_header`
 * string Node keeps on a ClientRequest, which surfaces inside AxiosError details).
 */
export const REDACTED = '[redacted]';

export const SENSITIVE_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key', 'apikey', 'x-auth-token',
  'x-access-token', 'x-refresh-token', 'x-csrf-token', 'x-xsrf-token', 'x-amz-security-token', 'x-forwarded-authorization',
]);

/** Whole words (after splitting camelCase, snake_case and kebab-case) that mark a key as a secret. */
const SENSITIVE_WORDS = new Set(['password', 'passwd', 'passwort', 'passphrase', 'pass', 'pwd', 'secret', 'secrets', 'token', 'tokens', 'authorization', 'apikey', 'credential', 'credentials', 'cvv', 'cvc', 'otp', 'pin', 'cookie', 'cookies', 'jwt']);
/** Adjacent word pairs that mark a key as a secret (api_key, cardNumber, private-key, session_id...). */
const SENSITIVE_PAIRS = new Set(['api key', 'card number', 'private key', 'session id', 'access token', 'refresh token', 'id token', 'client secret', 'auth key', 'secret key']);

const HEADER_LINE = /^([ \t]*)(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token|x-refresh-token)([ \t]*:[ \t]*)[^\r\n]*/gim;

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.toLowerCase());
}

/**
 * True for keys that name a credential. Matching is by whole word so that `total_tokens`, `footprint` or
 * `passenger` are kept while `accessToken`, `api_key`, `card-number` or `otp` are redacted.
 */
export function isSensitiveKey(key: string): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((word) => SENSITIVE_WORDS.has(word) || word.startsWith('passw'))) return true;
  return words.some((word, index) => index > 0 && SENSITIVE_PAIRS.has(`${words[index - 1]} ${word}`));
}

/** Numbers and booleans are never secrets (token counts, flags); strings, objects and arrays under a secret key are. */
export function isRedactable(value: unknown): boolean {
  return typeof value === 'string' || (typeof value === 'object' && value !== null);
}

/** Redacts credential lines inside a raw HTTP header block; other strings are returned unchanged. */
export function scrubHeaderBlock(value: string): string {
  return value.includes(':') ? value.replace(HEADER_LINE, `$1$2$3${REDACTED}`) : value;
}

export interface RedactOptions {
  /**
   * Also redact numbers and booleans under secret keys. Use it for user-supplied data (request bodies, query
   * strings, route params), where a numeric CVV, OTP, PIN or card number is plausible. Error details keep the
   * lenient default so counters such as `usage.total_tokens` stay visible.
   */
  strict?: boolean;
}

/** Replaces values under secret-looking keys (password, token, api key, card number...) at any depth. */
export function redactValue(value: unknown, depth = 0, options: RedactOptions = {}): unknown {
  if (value === null || value === undefined || typeof value !== 'object' || depth > 6) return value;
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes>`;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactValue(item, depth + 1, options));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const secret = isSensitiveKey(key) && (options.strict ? item !== null && item !== undefined : isRedactable(item));
    result[key] = secret ? REDACTED : redactValue(item, depth + 1, options);
  }
  return result;
}
