import { redactJsonFragments } from './diagnostic-redaction-json.js';

export const REDACTION_MARKER = '[REDACTED]';

const secretKey = [
  'access[-_ ]?token',
  'refresh[-_ ]?token',
  'api[-_ ]?key',
  'client[-_ ]?secret',
  'credential(?:s)?',
  'id[-_ ]?token',
  'password',
  'session',
  'secret',
  'token',
  'cookie',
  'set[-_]?cookie',
].join('|');
const authorization =
  /(\bauthorization\b\s*[:=]\s*)(?:(Basic|Bearer)\s+(?:"[^"]*"|'[^']*'|[^\s,;&#]+)|(Digest)\s+[^;\r\n]+|(?:"[^"]*"|'[^']*'|[^\s,;&#]+))/gi;
const authenticationScheme =
  /\b(Basic|Bearer)\s+(?:"[^"]*"|'[^']*'|[^\s,;&#]+)|\b(Digest)\s+[^;\r\n]+/gi;
const cookieHeader = /(\b(?:cookie|set-cookie)\b\s*:\s*)[^\r\n]*/gi;
const keyedSecret = new RegExp(
  `(\\b(?:${secretKey})\\b\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;&#]+)`,
  'gi',
);

export function redactDiagnosticText(value: string): string {
  const structured = redactJsonFragments(value, redactDiagnosticText);
  return redactPlainText(structured);
}

export function redactSessionSecrets(value: string): string {
  return redactDiagnosticText(value);
}

function redactPlainText(value: string): string {
  return value
    .replace(authorization, authorizationReplacement)
    .replace(authenticationScheme, authenticationReplacement)
    .replace(cookieHeader, `$1${REDACTION_MARKER}`)
    .replace(keyedSecret, `$1${REDACTION_MARKER}`);
}

function authorizationReplacement(
  _match: string,
  prefix: string,
  simpleScheme?: string,
  digestScheme?: string,
): string {
  const scheme = simpleScheme ?? digestScheme;
  return `${prefix}${scheme === undefined ? '' : `${scheme} `}${REDACTION_MARKER}`;
}

function authenticationReplacement(
  _match: string,
  simpleScheme?: string,
  digestScheme?: string,
): string {
  return `${simpleScheme ?? digestScheme} ${REDACTION_MARKER}`;
}
