import { inspect } from "node:util";

/** Registered secret literals, masked by redact() just before output. */
const secrets = new Set<string>();

export function registerSecret(value: string): void {
  if (value) secrets.add(value);
}

/** Matches the password in credential-bearing URIs: proto://user:pass@ */
const URI_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/[^:@/\s]+):[^@/\s]+@/gi;

/**
 * Masks every registered secret and anything shaped like URI credentials.
 * Belt and suspenders for logs from dependencies we don't control.
 */
export function redact(text: string): string {
  let out = text.replace(URI_CREDENTIALS, "$1:***@");
  for (const s of secrets) out = out.split(s).join("***");
  return out;
}

/** A full DSN embeds the password; log this form instead. */
export function sanitizeDsn(dsn: string): string {
  return dsn.replace(URI_CREDENTIALS, "$1@");
}

/**
 * A password that cannot be printed by accident. Every render path — string
 * coercion, JSON, console.log/util.inspect — yields "***". The raw value is
 * available only through reveal(), used at the single point of driver
 * connection. Constructing one also registers it with the log redactor.
 */
export class Secret {
  #value: string;

  constructor(value: string) {
    this.#value = value;
    registerSecret(value);
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return "***";
  }

  toJSON(): string {
    return "***";
  }

  [inspect.custom](): string {
    return "***";
  }
}

let installed = false;

/**
 * Installs the redaction filter at the log boundary: everything written to
 * stderr (console.error included) is masked just before output. stdout is
 * the MCP stream and never carries logs.
 */
export function installLogRedaction(): void {
  if (installed) return;
  installed = true;
  const original = process.stderr.write.bind(process.stderr) as (...args: unknown[]) => boolean;
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) =>
    original(typeof chunk === "string" ? redact(chunk) : chunk, ...rest)) as typeof process.stderr.write;
}
