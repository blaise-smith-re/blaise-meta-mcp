/**
 * A tiny logger that redacts secrets before anything reaches stdio/stderr.
 *
 * Two layers of protection:
 *  1. Any registered secret value (exact string, e.g. the live access token)
 *     is replaced wherever it appears, even inside a larger string like a URL.
 *  2. A generic pattern catches token-shaped substrings (long runs of
 *     base64url-ish characters) that weren't explicitly registered — useful
 *     for values coming back from the Graph API in error payloads.
 *
 * stdio transport MUST NOT write to stdout (it's the MCP wire protocol), so
 * every level logs to stderr.
 */

const REDACTED = "[REDACTED]";

// Matches long token-like runs: 20+ chars of letters/digits/-/_/. — well
// beyond what any legitimate log message needs to include verbatim.
const TOKEN_LIKE_PATTERN = /[A-Za-z0-9\-_.]{20,}/g;

let registeredSecrets: string[] = [];

/** Register secret values (e.g. from config) so every log call redacts them. */
export function registerSecrets(secrets: string[]): void {
  registeredSecrets = [...new Set([...registeredSecrets, ...secrets.filter(Boolean)])]
    .filter((s) => s.length > 0)
    .sort((a, b) => b.length - a.length); // longest-first avoids partial-overlap artifacts
}

/** Test-only: clear registered secrets between test cases. */
export function clearRegisteredSecrets(): void {
  registeredSecrets = [];
}

export function redact(input: unknown): string {
  let text = typeof input === "string" ? input : safeStringify(input);
  for (const secret of registeredSecrets) {
    if (secret.length < 6) continue; // too short to safely pattern-match
    text = text.split(secret).join(REDACTED);
  }
  text = text.replace(TOKEN_LIKE_PATTERN, (match) => {
    // Leave short, common non-secret tokens (IDs, ISO timestamps) alone.
    if (/^\d+$/.test(match)) return match; // pure numeric IDs
    if (/^\d{4}-\d{2}-\d{2}/.test(match)) return match; // timestamps
    return REDACTED;
  });
  return text;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  private minLevel: LogLevel = "info";

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const line = meta === undefined ? redact(message) : `${redact(message)} ${redact(meta)}`;
    // All levels go to stderr: stdout is reserved for the stdio MCP transport.
    console.error(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${line}`);
  }

  debug(message: string, meta?: unknown): void {
    this.write("debug", message, meta);
  }
  info(message: string, meta?: unknown): void {
    this.write("info", message, meta);
  }
  warn(message: string, meta?: unknown): void {
    this.write("warn", message, meta);
  }
  error(message: string, meta?: unknown): void {
    this.write("error", message, meta);
  }
}

export const logger = new Logger();
