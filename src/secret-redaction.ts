const bearerSecret = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const authorizationSecret = /(\bauthorization\b\s*[:=]\s*(?:Basic|Bearer)\s+)[^\s,;&]+/gi;
const authorizationValue =
  /(\bauthorization\b\s*[:=]\s*)(?!(?:Basic|Bearer)\s)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const jsonSecret =
  /("(?:cookie|set-cookie|token|access_token|refresh_token|password|authorization|api_key|client_secret)"\s*:\s*)"(?:\\.|[^"\\])*"/gi;
const cookieHeader = /(\b(?:cookie|set-cookie)\b\s*:\s*)[^\r\n]*/gi;
const keyedSecret =
  /(\b(?:cookie|set-cookie|token|access_token|refresh_token|password|api_key|client_secret)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;

const sensitiveKeys = new Set([
  'cookie',
  'cookies',
  'setcookie',
  'token',
  'accesstoken',
  'refreshtoken',
  'password',
  'authorization',
  'apikey',
  'clientsecret',
  'credential',
  'credentials',
  'session',
  'secret',
]);

export function redactSessionSecrets(value: string): string {
  const structured = redactJsonDocument(value);
  if (structured !== undefined) return structured;
  return value
    .replace(authorizationSecret, '$1[REDACTED]')
    .replace(authorizationValue, '$1[REDACTED]')
    .replace(bearerSecret, 'Bearer [REDACTED]')
    .replace(jsonSecret, '$1"[REDACTED]"')
    .replace(cookieHeader, '$1[REDACTED]')
    .replace(keyedSecret, '$1[REDACTED]');
}

function redactJsonDocument(value: string): string | undefined {
  try {
    return JSON.stringify(redactJsonValue(JSON.parse(value)));
  } catch {
    return undefined;
  }
}

function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      sensitiveKeys.has(normalizedKey(key)) ? '[REDACTED]' : redactJsonValue(child),
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}
