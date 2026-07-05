#!/usr/bin/env node
/**
 * talise — the Talise wallet in your terminal.
 *
 * Payments, natural language (DeepSeek), and agent-to-agent money on Sui.
 * Same backend and same non-custodial zkLogin as the mobile app.
 */
import { resolveBaseUrl, loadSession, saveSession, sessionPath, type Session } from "./config.js";
import { login, logout } from "./auth.js";
import { whoami, balance, activity, resolve } from "./commands/read.js";
import { send, request } from "./commands/send.js";
import { swap, save, withdraw, cashout } from "./commands/earn.js";
import { ask, chat } from "./commands/ask.js";
import { agentWhoami, agentPay, agentRecv } from "./commands/agent.js";
import { fail, note, type OutputMode } from "./format.js";
import { readFileSync, existsSync, statSync } from "node:fs";

type Flags = {
  json: boolean;
  quiet: boolean;
  yes: boolean;
  baseUrl?: string;
  limit?: number;
  asset: string;
  venue?: string;
  memo?: string;
  to?: string;
  amount?: string;
  note?: string;
  since?: number;
  _: string[];
};

function parseArgs(argv: string[]): Flags {
  const f: Flags = { json: false, quiet: false, yes: false, asset: "USDsui", _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--json": f.json = true; break;
      case "--quiet": case "-q": f.quiet = true; break;
      case "--yes": case "-y": f.yes = true; break;
      case "--base-url": f.baseUrl = argv[++i]; break;
      case "--limit": f.limit = Number(argv[++i]); break;
      case "--asset": f.asset = argv[++i] ?? "USDsui"; break;
      case "--venue": f.venue = argv[++i]; break;
      case "--memo": f.memo = argv[++i]; break;
      case "--to": f.to = argv[++i]; break;
      case "--amount": f.amount = argv[++i]; break;
      case "--note": f.note = argv[++i]; break;
      case "--since": f.since = Number(argv[++i]); break;
      default:
        if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
        f._.push(a);
    }
  }
  return f;
}

const HELP = `talise — Talise wallet in your terminal

Usage
  talise <command> [args] [flags]

Account
  login                        sign in via your browser
  logout                       wipe the local session
  whoami                       your address, @handle, email

Money
  balance                      USDsui + SUI + total USD
  activity [--limit N]         recent transactions
  resolve <name|@handle>       resolve a recipient to a 0x address
  send <amount> <recipient>    send money            [--asset USDsui|SUI] [--yes]
  request <amount> [--note …]  mint a payment link
  swap <amount> <SUI|USDC|DEEP>   swap to USDsui
  save <amount> [--venue …]    supply to a yield venue
  withdraw [amount] [--venue …]   pull from a yield venue (no amount = all)
  cashout <amount>             cash out to your linked bank

Natural language (DeepSeek)
  ask "<text>"                 one-shot: reply + run the intent on confirm
  chat                         interactive assistant

Agent-to-agent
  agent whoami                 machine identity block (for discovery)
  agent pay --to <r> --amount <n> [--memo …]   pay another agent
  agent recv [--since <ms>]    print inbound settlements
  session export | import      move a provisioned session between machines

Flags
  --json        machine output on stdout (logs on stderr)
  --yes, -y     skip confirmation (required to move money non-interactively)
  --base-url    override API host (must be a talise.io host)
  --quiet, -q   suppress human chatter

Docs: cli/PLAN.md`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP + "\n");
    return;
  }
  if (argv[0] === "version" || argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write("talise 0.1.0\n");
    return;
  }

  const cmd = argv[0]!;
  const flags = parseArgs(argv.slice(1));
  const mode: OutputMode = { json: flags.json, quiet: flags.quiet, yes: flags.yes };
  const baseUrl = resolveBaseUrl(flags.baseUrl);

  switch (cmd) {
    case "login": await login(baseUrl, mode); break;
    case "logout": logout(mode); break;
    case "whoami": await whoami(baseUrl, mode); break;
    case "balance": case "bal": await balance(baseUrl, mode); break;
    case "activity": await activity(baseUrl, mode, flags.limit ?? 20); break;
    case "resolve": {
      const q = flags._[0];
      if (!q) throw new Error("usage: talise resolve <name|@handle|0x…>");
      await resolve(baseUrl, mode, q);
      break;
    }
    case "send": case "pay": {
      const [amount, recipient] = flags._;
      if (!amount || !recipient) throw new Error("usage: talise send <amount> <recipient>");
      await send(baseUrl, mode, amount, recipient, flags.asset);
      break;
    }
    case "request": {
      const amount = flags._[0];
      if (!amount) throw new Error("usage: talise request <amount> [--note …]");
      await request(baseUrl, mode, amount, flags.note);
      break;
    }
    case "swap": {
      const [amount, from] = flags._;
      if (!amount || !from) throw new Error("usage: talise swap <amount> <SUI|USDC|DEEP>");
      await swap(baseUrl, mode, amount, from);
      break;
    }
    case "save": {
      const amount = flags._[0];
      if (!amount) throw new Error("usage: talise save <amount> [--venue navi|deepbook]");
      await save(baseUrl, mode, amount, flags.venue);
      break;
    }
    case "withdraw": {
      // amount optional: `talise withdraw` or `withdraw all` = full position.
      await withdraw(baseUrl, mode, flags._[0], flags.venue);
      break;
    }
    case "cashout": {
      const amount = flags._[0];
      if (!amount) throw new Error("usage: talise cashout <amount>");
      await cashout(baseUrl, mode, amount);
      break;
    }
    case "ask": {
      const prompt = flags._.join(" ");
      if (!prompt) throw new Error('usage: talise ask "<what you want>"');
      await ask(baseUrl, mode, prompt);
      break;
    }
    case "chat": await chat(baseUrl, mode); break;
    case "agent": {
      const sub = flags._[0];
      if (sub === "whoami") await agentWhoami(baseUrl, mode);
      else if (sub === "pay") await agentPay(baseUrl, mode, flags);
      else if (sub === "recv") await agentRecv(baseUrl, mode, flags.since ?? 0);
      else throw new Error("usage: talise agent <whoami|pay|recv>");
      break;
    }
    case "session": {
      const sub = flags._[0];
      if (sub === "export") sessionExport(mode);
      else if (sub === "import") sessionImport(mode, flags._[1]);
      else throw new Error("usage: talise session <export|import [file]>");
      break;
    }
    default:
      throw new Error(`unknown command: ${cmd}\nrun \`talise help\``);
  }
}

/** Export the provisioned session as base64 (to move it to an agent host). */
function sessionExport(mode: OutputMode): void {
  const s = loadSession();
  if (!s) throw new Error("no session to export — run `talise login` first");
  const b64 = Buffer.from(JSON.stringify(s)).toString("base64");
  process.stdout.write(b64 + "\n");
  note(mode, "set this on the agent host as TALISE_SESSION, or `talise session import`");
}

/** Import a base64 session (from stdin, a file, or an inline arg). */
function sessionImport(mode: OutputMode, arg?: string): void {
  const raw = arg
    ? (isFile(arg) ? readFileSync(arg, "utf8") : arg)
    : readFileSync(0, "utf8"); // stdin
  const s = JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8")) as Session;
  if (!s.bearer || !s.ephemeralSecretB64) throw new Error("not a valid Talise session");
  saveSession(s);
  note(mode, "session imported to " + sessionPath());
}

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

main().catch((e: unknown) => {
  const mode: OutputMode = {
    json: process.argv.includes("--json"),
    quiet: process.argv.includes("--quiet"),
    yes: false,
  };
  const err = e as { message?: string; code?: string };
  fail(mode, err.message ?? String(e), err.code);
});
