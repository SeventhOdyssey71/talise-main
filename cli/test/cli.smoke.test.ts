/**
 * End-to-end smoke tests: build the CLI and drive the real binary. Covers the
 * offline paths (help, version, arg validation, host allowlist, error exit
 * codes) without any network or a signed-in session. TALISE_CONFIG_DIR points
 * at a throwaway dir so the real ~/.talise is never touched.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bin = join(pkgRoot, "dist", "index.js");
let tmpCfg: string;

type Run = { code: number; stdout: string; stderr: string };

function run(args: string[]): Run {
  try {
    const stdout = execFileSync("node", [bin, ...args], {
      encoding: "utf8",
      env: { ...process.env, TALISE_CONFIG_DIR: tmpCfg, NO_COLOR: "1" },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

beforeAll(() => {
  execSync("npx tsc -p tsconfig.json", { cwd: pkgRoot, stdio: "ignore" });
  tmpCfg = mkdtempSync(join(tmpdir(), "talise-cli-smoke-"));
}, 120_000);

afterAll(() => rmSync(tmpCfg, { recursive: true, force: true }));

describe("talise binary (offline paths)", () => {
  it("--version prints the package version and exits 0", () => {
    const r = run(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^talise \d+\.\d+\.\d+/);
  });

  it("help lists commands and exits 0", () => {
    const r = run(["help"]);
    expect(r.code).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("send");
    expect(r.stdout.toLowerCase()).toContain("login");
  });

  it("an unknown command exits non-zero with a helpful message", () => {
    const r = run(["frobnicate"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/unknown command/i);
  });

  it("rejects an unknown flag", () => {
    const r = run(["balance", "--wat"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/unknown flag/i);
  });

  it("a numeric flag with no value fails instead of sending NaN", () => {
    const r = run(["activity", "--limit"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/--limit needs a number/i);
  });

  it("refuses a non-talise --base-url before any request", () => {
    const r = run(["balance", "--base-url", "https://evil.com"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/refusing to use base URL/i);
  });

  it("a command needing auth without a session says to log in", () => {
    const r = run(["balance"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/not signed in/i);
  });
});
