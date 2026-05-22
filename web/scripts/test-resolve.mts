import { SuinsClient } from "@mysten/suins";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
function validateSui(full: string): boolean {
  if (!full.endsWith(".sui")) return false;
  const labels = full.split(".");
  if (labels.length < 2) return false;
  return labels.every((l) => /^[a-z0-9_]{1,63}$/.test(l));
}
function candidateSuinsNames(raw: string): string[] {
  let s = raw.trim().toLowerCase();
  if (!s) return [];
  if (s.startsWith("@")) s = s.slice(1);
  if (s.endsWith("@talise.sui")) {
    const b = s.slice(0, -"@talise.sui".length);
    return USERNAME_RE.test(b) ? [`${b}.talise.sui`] : [];
  }
  if (s.endsWith("@talise")) {
    const b = s.slice(0, -"@talise".length);
    return USERNAME_RE.test(b) ? [`${b}.talise.sui`] : [];
  }
  if (s.endsWith(".talise.sui")) return validateSui(s) ? [s] : [];
  if (s.endsWith(".sui")) return validateSui(s) ? [s] : [];
  if (USERNAME_RE.test(s)) return [`${s}.talise.sui`, `${s}.sui`];
  return [];
}

const sui = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("mainnet"), network: "mainnet" });
const suins = new SuinsClient({ client: sui as never, network: "mainnet" });

for (const q of [
  "eromonsele",
  "eromonsele@talise",
  "eromonsele@talise.sui",
  "eromonsele.talise.sui",
  "@eromonsele",
  "jude",
  "jude@talise.sui",
]) {
  const cands = candidateSuinsNames(q);
  let resolved = null as null | { name: string; addr: string };
  for (const c of cands) {
    try {
      const rec = await suins.getNameRecord(c);
      if (rec?.targetAddress) { resolved = { name: c, addr: rec.targetAddress }; break; }
    } catch {}
  }
  console.log(
    (resolved ? "✓ " : "✗ ") +
    q.padEnd(26) +
    " tried [" + (cands.join(", ") || "(none)") + "]" +
    (resolved ? `  →  ${resolved.addr.slice(0,10)}…${resolved.addr.slice(-6)}` : "")
  );
}
