/**
 * `talise login` — browser loopback sign-in (like `gh auth login`).
 *
 * 1. Generate an ephemeral Ed25519 keypair; the 32-byte secret stays local.
 * 2. Start a one-shot loopback server on 127.0.0.1:<port> with a CSRF token.
 * 3. Open the browser to /api/auth/cli/start?ephemeralPubKey&port&csrf.
 *    The backend binds (pubkey, maxEpoch, randomness), runs Google OAuth, and
 *    redirects the browser back to http://127.0.0.1:<port>/cb with the bearer
 *    and the maxEpoch/randomness the JWT nonce was bound to.
 * 4. Persist the full session. The signing key never touches a server.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { newEphemeralKey } from "./signer.js";
import { makeApi } from "./http.js";
import { saveSession, clearSession, type Session } from "./config.js";
import { note, ok, shortAddr, type OutputMode } from "./format.js";

const b64url = (b: Buffer | Uint8Array) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function login(baseUrl: string, mode: OutputMode): Promise<Session> {
  const eph = newEphemeralKey();
  const csrf = b64url(randomBytes(18));

  const { params } = await runLoopback(async (port) => {
    const url =
      `${baseUrl}/api/auth/cli/start` +
      `?ephemeralPubKey=${encodeURIComponent(pubKeyToUrlSafe(eph.pubKeyB64))}` +
      `&port=${port}` +
      `&csrf=${encodeURIComponent(csrf)}`;
    note(mode, "Opening your browser to sign in…");
    note(mode, "If it doesn't open, visit:\n  " + url);
    openBrowser(url);
  }, csrf);

  const token = params.token;
  const userId = params.userId;
  const maxEpoch = Number(params.maxEpoch);
  const randomness = params.randomness;
  if (!token || !userId || !Number.isFinite(maxEpoch) || !randomness) {
    throw new Error("sign-in callback missing required fields");
  }

  // Fetch identity (address + @handle) with the fresh bearer.
  const api = makeApi(baseUrl, token);
  let address: string | undefined;
  let handle: string | undefined;
  try {
    const me = await api.get<{ suiAddress?: string; taliseHandle?: string }>("/api/me");
    address = me.suiAddress;
    handle = me.taliseHandle ?? undefined;
  } catch {
    /* identity is best-effort; the session is still valid */
  }

  const session: Session = {
    bearer: token,
    userId,
    address,
    handle,
    ephemeralSecretB64: eph.secretB64,
    ephemeralPubKeyB64: eph.pubKeyB64,
    maxEpoch,
    randomness,
    baseUrl,
    createdAt: Date.now(),
  };
  saveSession(session);
  ok(mode, `signed in${handle ? " as @" + handle : ""}${address ? " (" + shortAddr(address) + ")" : ""}`);
  return session;
}

/**
 * Provision a CUSTODIAL agent wallet via the browser. The server generates and
 * holds the signing key; the loopback receives only a scoped agent token (shown
 * once). Requires the account to be signed in and the feature enabled server-side.
 */
export async function provisionAgent(
  baseUrl: string,
  mode: OutputMode,
  opts: { name?: string; cap: number },
): Promise<{ agentToken: string; agentId: string; address: string }> {
  const csrf = b64url(randomBytes(18));
  const { params } = await runLoopback(async (port) => {
    const url =
      `${baseUrl}/api/auth/agent/start` +
      `?port=${port}&csrf=${encodeURIComponent(csrf)}&cap=${encodeURIComponent(String(opts.cap))}` +
      (opts.name ? `&name=${encodeURIComponent(opts.name)}` : "");
    note(mode, "Opening your browser to authorize the agent wallet…");
    note(mode, "If it doesn't open, visit:\n  " + url);
    openBrowser(url);
  }, csrf);

  const agentToken = params.agentToken;
  const agentId = params.agentId;
  const address = params.address ?? "";
  if (!agentToken || !agentId) throw new Error("provisioning callback missing the agent token");
  return { agentToken, agentId, address };
}

export function logout(mode: OutputMode): void {
  clearSession();
  ok(mode, "signed out - local session wiped");
}

/** iOS sends the pubkey base64URL (so `+` doesn't get URL-decoded to a space). */
function pubKeyToUrlSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Start a one-shot loopback server, invoke `onReady(port)`, resolve when the
 *  browser redirects back with a valid (csrf-checked) callback. Returns the raw
 *  query params so different flows (login, agent provision) extract their own. */
function runLoopback(
  onReady: (port: number) => void | Promise<void>,
  expectedCsrf: string,
): Promise<{ params: Record<string, string>; port: number }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("timed out after 3 minutes"));
    }, 3 * 60_000);

    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== "/cb") {
        res.writeHead(404).end();
        return;
      }
      const q = u.searchParams;
      const err = q.get("err") || q.get("error");
      if (err) {
        respond(res, "Failed", `Talise authorization failed: ${escapeHtml(err)}. You can close this tab.`);
        cleanup();
        reject(new Error(`authorization failed: ${err}`));
        return;
      }
      if (q.get("csrf") !== expectedCsrf) {
        res.writeHead(400).end("bad csrf");
        return; // ignore — could be a stray/forged hit; keep waiting
      }
      respond(res, "Done", "Authorized. You can close this tab and return to your terminal.");
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const params: Record<string, string> = {};
      for (const [k, v] of q.entries()) params[k] = v;
      cleanup();
      resolve({ params, port });
    });

    function cleanup() {
      clearTimeout(timeout);
      server.close();
    }

    server.on("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });

    // Bind to an ephemeral port on loopback only.
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      try {
        await onReady(port);
      } catch (e) {
        cleanup();
        reject(e as Error);
      }
    });
  });
}

function respond(res: import("node:http").ServerResponse, title: string, body: string): void {
  const html =
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<style>body{font-family:system-ui;background:#0b0b0b;color:#f2f2f2;display:grid;place-items:center;height:100vh;margin:0}` +
    `.c{max-width:420px;text-align:center;padding:2rem}h1{color:#79D96C;font-size:1.3rem}p{color:#b5b5b5;line-height:1.6}</style>` +
    `<div class="c"><h1>${title}</h1><p>${body}</p></div>`;
  res.writeHead(200, { "Content-Type": "text/html" }).end(html);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] || c);
}

/** Open a URL in the default browser, cross-platform. Best-effort. */
function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* user can copy the URL from the printed line */
  }
}
