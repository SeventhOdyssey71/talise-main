/**
 * Output + prompts. In --json mode, structured data goes to stdout and all
 * human chatter goes to stderr, so a script can parse stdout cleanly. In human
 * mode we print friendly, colorized text.
 */
import { createInterface } from "node:readline";

export type OutputMode = { json: boolean; quiet: boolean; yes: boolean };

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function color(on: boolean, c: keyof typeof C, s: string): string {
  return on ? `${C[c]}${s}${C.reset}` : s;
}

// Color is on only for an interactive terminal, and off when the user opts out.
// Follows the NO_COLOR convention (https://no-color.org) + a --no-color flag.
let colorDisabled = false;
export function disableColor(): void {
  colorDisabled = true;
}
function colorEnabled(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !colorDisabled;
}

/** Emit a machine result. In --json mode: one JSON line on stdout. Otherwise a
 *  human render (via the provided renderer). */
export function emit(mode: OutputMode, data: unknown, human: (d: unknown) => void): void {
  if (mode.json) {
    process.stdout.write(JSON.stringify(data) + "\n");
  } else {
    human(data);
  }
}

/** Human note — goes to stderr in --json mode so stdout stays pure data. */
export function note(mode: OutputMode, msg: string): void {
  if (mode.quiet) return;
  const stream = mode.json ? process.stderr : process.stdout;
  stream.write(msg + "\n");
}

export function ok(mode: OutputMode, msg: string): void {
  note(mode, color(colorEnabled(), "green", "✓ ") + msg);
}

export function warn(msg: string): void {
  process.stderr.write(color(colorEnabled(), "yellow", "! ") + msg + "\n");
}

export function fail(mode: OutputMode, msg: string, code?: string): never {
  if (mode.json) {
    process.stdout.write(JSON.stringify({ ok: false, error: msg, code }) + "\n");
  } else {
    process.stderr.write(color(colorEnabled(), "red", "✗ ") + msg + "\n");
  }
  process.exit(1);
}

export function heading(s: string): string {
  return color(colorEnabled(), "bold", s);
}

export function dim(s: string): string {
  return color(colorEnabled(), "dim", s);
}

export function money(s: string): string {
  return color(colorEnabled(), "green", s);
}

/**
 * Confirm a destructive/money action. Returns true to proceed.
 *  - `--yes` always proceeds.
 *  - non-interactive (no TTY) WITHOUT `--yes` refuses, so a stray script can't
 *    move money silently.
 */
export async function confirm(mode: OutputMode, prompt: string): Promise<boolean> {
  if (mode.yes) return true;
  if (!process.stdin.isTTY) {
    fail(
      mode,
      "refusing to move money non-interactively without --yes (no TTY to confirm)",
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) =>
      rl.question(prompt + color(colorEnabled(), "dim", " [y/N] "), resolve),
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export function usd(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
