type JsonFragment = { end: number; value: unknown };

const sensitiveKeys = new Set([
  'authorization',
  'cookie',
  'cookies',
  'setcookie',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'password',
  'apikey',
  'xapikey',
  'clientsecret',
  'credential',
  'credentials',
  'session',
  'secret',
]);

export function redactJsonFragments(input: string, redactText: (value: string) => string): string {
  let output = '';
  let cursor = 0;
  let scan = 0;
  while (scan < input.length) {
    const fragment = parseJsonAt(input, scan);
    if (fragment === undefined) {
      scan += 1;
      continue;
    }
    output += input.slice(cursor, scan) + serializeRedacted(fragment.value, redactText);
    cursor = fragment.end;
    scan = fragment.end;
  }
  return output + input.slice(cursor);
}

function parseJsonAt(input: string, start: number): JsonFragment | undefined {
  const closing = closingCharacter(input[start]);
  if (closing === undefined) return undefined;
  return parseJsonWithClosing(input, start, closing);
}

function parseJsonWithClosing(
  input: string,
  start: number,
  closing: string,
): JsonFragment | undefined {
  for (let end = start + 1; end <= input.length; end += 1) {
    if (input[end - 1] !== closing) continue;
    const value = tryParse(input.slice(start, end));
    if (value !== undefined) return { end, value };
  }
  return undefined;
}

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function closingCharacter(opening: string): string | undefined {
  if (opening === '{') return '}';
  if (opening === '[') return ']';
  return undefined;
}

function serializeRedacted(value: unknown, redactText: (value: string) => string): string {
  return JSON.stringify(redactJsonValue(value, redactText));
}

function redactJsonValue(value: unknown, redactText: (value: string) => string): unknown {
  if (Array.isArray(value)) return value.map((child) => redactJsonValue(child, redactText));
  if (isRecord(value)) return redactRecord(value, redactText);
  if (typeof value === 'string') return redactText(value);
  return value;
}

function redactRecord(
  value: Record<string, unknown>,
  redactText: (value: string) => string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : redactJsonValue(child, redactText),
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isSensitiveKey(key: string): boolean {
  return sensitiveKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
}
