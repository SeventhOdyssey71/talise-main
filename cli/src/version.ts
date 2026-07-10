/** The published package version, read from package.json at runtime. Resolves
 *  relative to the compiled file (dist/version.js -> ../package.json), so it is
 *  correct whether run from source, dist, or an npm-installed location. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function pkgVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    );
    return String(pkg.version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}
