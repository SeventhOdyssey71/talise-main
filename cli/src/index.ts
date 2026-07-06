#!/usr/bin/env node
/**
 * talise — the Talise wallet in your terminal.
 *
 * Payments, natural language, and agent-to-agent money on Sui. Same backend and
 * same non-custodial zkLogin as the mobile app.
 *
 * CLI conventions (per clig.dev / 12-factor CLI): every command has --help;
 * --version prints the real version; data goes to stdout and messages to stderr
 * (so `--json` is pipeable); color is TTY-aware and honors NO_COLOR / --no-color;
 * exit code is 0 on success, non-zero on failure.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveBaseUrl, loadSession, saveSession, sessionPath, type Session } from "./config.js";
import { login, logout } from "./auth.js";
import { whoami, balance, activity, resolve } from "./commands/read.js";
import { send, request } from "./commands/send.js";
import { swap, save, withdraw, cashout } from "./commands/earn.js";
import { ask, chat } from "./commands/ask.js";
import { agentWhoami, agentPay, agentRecv, agentProvision, agentWallets, agentRevoke } from "./commands/agent.js";
import { batch, teams, streamCreate, streamList, streamCancel } from "./commands/payouts.js";
import { runMcp } from "./mcp.js";
import { fail, note, disableColor, type OutputMode } from "./format.js";
import { existsSync, statSync } from "node:fs";

function version(): string {
  try {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
    return String(pkg.version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

type Flags = {
  json: boolean;
  quiet: boolean;
  yes: boolean;
  help: boolean;
  noColor: boolean;
  baseUrl?: string;
  limit?: number;
  asset: string;
  venue?: string;
  memo?: string;
  to?: string;
  toList: string[];
  amount?: string;
  note?: string;
  since?: number;
  team?: string;
  file?: string;
  total?: string;
  tranches?: string;
  interval?: string;
  token?: string;
  cap?: string;
  name?: string;
  _: string[];
};

function parseArgs(argv: string[]): Flags {
  const f: Flags = { json: false, quiet: false, yes: false, help: false, noColor: false, asset: "USDsui", toList: [], _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") { f._.push(...argv.slice(i + 1)); break; }
    switch (a) {
      case "--json": f.json = true; break;
      case "--quiet": case "-q": f.quiet = true; break;
      case "--yes": case "-y": f.yes = true; break;
      case "--help": case "-h": f.help = true; break;
      case "--no-color": f.noColor = true; break;
      case "--base-url": f.baseUrl = argv[++i]; break;
      case "--limit": f.limit = Number(argv[++i]); break;
      case "--asset": f.asset = argv[++i] ?? "USDsui"; break;
      case "--venue": f.venue = argv[++i]; break;
      case "--memo": f.memo = argv[++i]; break;
      case "--to": { const v = argv[++i]; if (v) { f.toList.push(v); f.to ??= v; } break; }
      case "--amount": f.amount = argv[++i]; break;
      case "--note": f.note = argv[++i]; break;
      case "--since": f.since = Number(argv[++i]); break;
      case "--team": f.team = argv[++i]; break;
      case "--file": f.file = argv[++i]; break;
      case "--total": f.total = argv[++i]; break;
      case "--tranches": f.tranches = argv[++i]; break;
      case "--interval": f.interval = argv[++i]; break;
      case "--token": f.token = argv[++i]; break;
      case "--cap": f.cap = argv[++i]; break;
      case "--name": f.name = argv[++i]; break;
      default:
        if (a.startsWith("-")) throw new Error(`unknown flag: ${a}  (run \`talise help\`)`);
        f._.push(a);
    }
  }
  return f;
}

// ── Command registry ────────────────────────────────────────────────────────
type Ctx = { baseUrl: string; mode: OutputMode; flags: Flags };
type Group = "Account" | "Money" | "Assistant" | "Agent" | "Other";

type Command = {
  name: string;
  aliases?: string[];
  group: Group;
  usage: string;
  summary: string;
  help: string; // shown by `talise <cmd> --help`
  run: (ctx: Ctx) => Promise<void> | void;
};

const COMMANDS: Command[] = [
  {
    name: "login", group: "Account", usage: "login", summary: "sign in via your browser",
    help: "Opens your browser to sign in with Google. Stores a local session in the\nconfig dir (mode 0600). Your signing key is generated locally and never leaves\nyour machine.",
    run: ({ baseUrl, mode }) => login(baseUrl, mode).then(() => undefined),
  },
  {
    name: "logout", group: "Account", usage: "logout", summary: "wipe the local session",
    help: "Deletes the local session file. You'll need `talise login` again to sign or read.",
    run: ({ mode }) => logout(mode),
  },
  {
    name: "whoami", group: "Account", usage: "whoami", summary: "your address, @handle, email",
    help: "Prints the signed-in identity.\n\nExamples:\n  talise whoami\n  talise whoami --json",
    run: ({ baseUrl, mode }) => whoami(baseUrl, mode),
  },
  {
    name: "balance", aliases: ["bal"], group: "Money", usage: "balance", summary: "USDsui + SUI + total USD",
    help: "Shows your holdings.\n\nExamples:\n  talise balance\n  talise balance --json",
    run: ({ baseUrl, mode }) => balance(baseUrl, mode),
  },
  {
    name: "activity", group: "Money", usage: "activity [--limit N]", summary: "recent transactions",
    help: "Lists recent transactions (default 20).\n\nExamples:\n  talise activity --limit 10\n  talise activity --json",
    run: ({ baseUrl, mode, flags }) => activity(baseUrl, mode, flags.limit ?? 20),
  },
  {
    name: "resolve", group: "Money", usage: "resolve <name|@handle|0x…>", summary: "resolve a recipient to a 0x address",
    help: "Resolves a Talise handle or SuiNS name to its on-chain address.\n\nExamples:\n  talise resolve @alice\n  talise resolve alice.talise.sui",
    run: ({ baseUrl, mode, flags }) => {
      const q = flags._[0];
      if (!q) throw usage("resolve <name|@handle|0x…>");
      return resolve(baseUrl, mode, q);
    },
  },
  {
    name: "send", aliases: ["pay"], group: "Money", usage: "send <amount> <recipient> [--asset USDsui|SUI]",
    summary: "send money",
    help: "Sends money to a name or address. Resolves, confirms, signs locally, and\nsubmits over the gasless rail.\n\nExamples:\n  talise send 5 @alice\n  talise send 5 0xabc…def --asset SUI\n  talise send 1 @bob --yes --json",
    run: ({ baseUrl, mode, flags }) => {
      const [amount, recipient] = flags._;
      if (!amount || !recipient) throw usage("send <amount> <recipient>");
      return send(baseUrl, mode, amount, recipient, flags.asset);
    },
  },
  {
    name: "request", group: "Money", usage: "request <amount> [--note …]", summary: "mint a payment link",
    help: "Creates a shareable payment link (no money moves, no signing).\n\nExamples:\n  talise request 20 --note \"lunch\"",
    run: ({ baseUrl, mode, flags }) => {
      const amount = flags._[0];
      if (!amount) throw usage("request <amount> [--note …]");
      return request(baseUrl, mode, amount, flags.note);
    },
  },
  {
    name: "swap", group: "Money", usage: "swap <amount> <SUI|USDC|DEEP>", summary: "swap to USDsui",
    help: "Swaps SUI, USDC, or DEEP into USDsui over the sponsored rail.\n\nExamples:\n  talise swap 2 SUI\n  talise swap 10 USDC --yes",
    run: ({ baseUrl, mode, flags }) => {
      const [amount, from] = flags._;
      if (!amount || !from) throw usage("swap <amount> <SUI|USDC|DEEP>");
      return swap(baseUrl, mode, amount, from);
    },
  },
  {
    name: "save", group: "Money", usage: "save <amount> [--venue navi|deepbook]", summary: "supply to a yield venue",
    help: "Supplies USDsui into a yield venue to earn.\n\nExamples:\n  talise save 10\n  talise save 10 --venue navi",
    run: ({ baseUrl, mode, flags }) => {
      const amount = flags._[0];
      if (!amount) throw usage("save <amount> [--venue navi|deepbook]");
      return save(baseUrl, mode, amount, flags.venue);
    },
  },
  {
    name: "withdraw", group: "Money", usage: "withdraw [amount] [--venue …]", summary: "pull from a yield venue",
    help: "Withdraws from a yield venue. Omit the amount (or `all`) to withdraw the\nfull position.\n\nExamples:\n  talise withdraw --venue navi\n  talise withdraw 5 --venue deepbook",
    run: ({ baseUrl, mode, flags }) => withdraw(baseUrl, mode, flags._[0], flags.venue),
  },
  {
    name: "cashout", group: "Money", usage: "cashout <amount>", summary: "cash out to your linked bank",
    help: "Cashes out USDsui to your linked bank via the off-ramp.\n\nExamples:\n  talise cashout 20",
    run: ({ baseUrl, mode, flags }) => {
      const amount = flags._[0];
      if (!amount) throw usage("cashout <amount>");
      return cashout(baseUrl, mode, amount);
    },
  },
  {
    name: "ask", group: "Assistant", usage: 'ask "<text>"', summary: "one-shot: reply + run the intent on confirm",
    help: "Ask the Talise assistant in plain English. It answers, and for a money ask it\nproposes a plan you confirm before anything signs.\n\nExamples:\n  talise ask \"what's my balance?\"\n  talise ask \"send 5 dollars to alice\"",
    run: ({ baseUrl, mode, flags }) => {
      const prompt = flags._.join(" ");
      if (!prompt) throw usage('ask "<what you want>"');
      return ask(baseUrl, mode, prompt);
    },
  },
  {
    name: "chat", group: "Assistant", usage: "chat", summary: "interactive assistant",
    help: "Opens an interactive session with the Talise assistant. Type /exit to leave.",
    run: ({ baseUrl, mode }) => chat(baseUrl, mode),
  },
  {
    name: "teams", group: "Money", usage: "teams", summary: "list saved payout teams",
    help: "Lists your saved payout teams and their member counts (pay one with\n`talise batch --team <id>`).",
    run: ({ baseUrl, mode }) => teams(baseUrl, mode),
  },
  {
    name: "batch", aliases: ["payroll"], group: "Money", usage: "batch (--team <id> | --file <path> | --to a=5 --to b=3)",
    summary: "pay many recipients in one signature",
    help:
      "Pays many recipients in ONE sponsored transaction. Recipients come from one of:\n" +
      "  --team <id>        a saved team (uses each member's default amount)\n" +
      "  --file <path>      JSON array [{\"to\",\"amount\",\"label\"?}] (or `-` for stdin)\n" +
      "  --to name=amount   repeatable inline legs\n\n" +
      "Examples:\n" +
      "  talise batch --team tm_abc\n" +
      "  talise batch --to @alice=5 --to @bob=3 --yes\n" +
      "  talise batch --file payroll.json --json",
    run: ({ baseUrl, mode, flags }) => batch(baseUrl, mode, { team: flags.team, file: flags.file, toList: flags.toList }),
  },
  {
    name: "stream", group: "Money", usage: "stream <create|list|cancel>", summary: "team payroll streams",
    help:
      "Split a total into tranches released to a team over time.\n\n" +
      "  stream create --team <id> --total <usd> --tranches <n> --interval <min>\n" +
      "  stream list\n" +
      "  stream cancel <id>\n\n" +
      "Examples:\n" +
      "  talise stream create --team tm_abc --total 100 --tranches 4 --interval 1440\n" +
      "  talise stream list --json",
    run: ({ baseUrl, mode, flags }) => {
      const sub = flags._[0];
      if (sub === "create") return streamCreate(baseUrl, mode, { team: flags.team, total: flags.total, tranches: flags.tranches, interval: flags.interval });
      if (sub === "list") return streamList(baseUrl, mode);
      if (sub === "cancel") return streamCancel(baseUrl, mode, flags._[1] ?? "");
      throw usage("stream <create|list|cancel>");
    },
  },
  {
    name: "agent", group: "Agent", usage: "agent <whoami|pay|recv|provision|wallets|revoke>", summary: "agent-to-agent money",
    help:
      "Non-interactive money for autonomous agents.\n\n" +
      "  agent whoami                     machine identity block for discovery\n" +
      "  agent pay --to <r> --amount <n> [--memo …] [--token …]   pay another agent\n" +
      "  agent recv [--since <ms>]        print inbound settlements\n\n" +
      "Custodial agent wallets (server holds the key, daily cap, revocable):\n" +
      "  agent provision --cap <usd/day> [--name …]   create one (browser auth)\n" +
      "  agent wallets                    list your agent wallets\n" +
      "  agent revoke <id>                revoke one instantly\n\n" +
      "`agent pay` signs locally with your session, OR — if TALISE_AGENT_TOKEN\n" +
      "(or --token) is set — via a custodial wallet (no local key). Money moves\n" +
      "need --yes when there's no TTY.\n\n" +
      "Examples:\n" +
      "  talise agent whoami --json\n" +
      "  talise agent pay --to @serviceB --amount 0.25 --memo \"job:1\" --yes --json\n" +
      "  talise agent provision --cap 5 --name ci-bot\n" +
      "  TALISE_AGENT_TOKEN=tak_… talise agent pay --to @svc --amount 0.1 --yes --json",
    run: ({ baseUrl, mode, flags }) => {
      const sub = flags._[0];
      if (sub === "whoami") return agentWhoami(baseUrl, mode);
      if (sub === "pay") return agentPay(baseUrl, mode, flags);
      if (sub === "recv") return agentRecv(baseUrl, mode, flags.since ?? 0);
      if (sub === "provision") return agentProvision(baseUrl, mode, { name: flags.name, cap: flags.cap });
      if (sub === "wallets") return agentWallets(baseUrl, mode);
      if (sub === "revoke") return agentRevoke(baseUrl, mode, flags._[1] ?? "");
      throw usage("agent <whoami|pay|recv|provision|wallets|revoke>");
    },
  },
  {
    name: "mcp", group: "Other", usage: "mcp", summary: "run as an MCP server (use Talise inside Claude)",
    help:
      "Starts a Model Context Protocol server over stdio, exposing Talise as tools\n" +
      "(balance, activity, resolve, ask, send) to Claude Desktop / Claude Code.\n" +
      "Sends require confirm:true, so nothing moves money by accident.\n\n" +
      "Add to Claude Desktop config (claude_desktop_config.json):\n" +
      '  { "mcpServers": { "talise": { "command": "talise", "args": ["mcp"] } } }',
    run: ({ baseUrl }) => runMcp(baseUrl),
  },
  {
    name: "session", group: "Agent", usage: "session <export|import [file]>", summary: "move a provisioned session",
    help:
      "Move a signed-in session between machines (e.g. to an agent host).\n\n" +
      "  session export           print the session as base64 (store as TALISE_SESSION)\n" +
      "  session import [file]     import base64 from a file, an arg, or stdin\n\n" +
      "Examples:\n" +
      "  export TALISE_SESSION=\"$(talise session export)\"\n" +
      "  talise session export | ssh host 'talise session import'",
    run: ({ flags, mode }) => {
      const sub = flags._[0];
      if (sub === "export") return sessionExport(mode);
      if (sub === "import") return sessionImport(mode, flags._[1]);
      throw usage("session <export|import [file]>");
    },
  },
];

const BY_NAME = new Map<string, Command>();
for (const c of COMMANDS) {
  BY_NAME.set(c.name, c);
  for (const a of c.aliases ?? []) BY_NAME.set(a, c);
}

function usage(u: string): Error {
  return new Error(`usage: talise ${u}`);
}

// ── Help rendering ──────────────────────────────────────────────────────────
function topHelp(): string {
  const groups: Group[] = ["Account", "Money", "Assistant", "Agent", "Other"];
  const lines: string[] = [
    "talise — Talise wallet in your terminal",
    "",
    "Usage",
    "  talise <command> [args] [flags]",
    "",
  ];
  for (const g of groups) {
    const cmds = COMMANDS.filter((c) => c.group === g);
    if (cmds.length === 0) continue;
    lines.push(g);
    // Overview lists the command NAME + summary (git/gh/cargo style); full
    // usage lives in `talise <cmd> --help`.
    for (const c of cmds) lines.push(`  ${c.name.padEnd(12)} ${c.summary}`);
    lines.push("");
  }
  lines.push(
    "Global flags",
    "  --json          machine output on stdout (messages on stderr)",
    "  --yes, -y       skip confirmation (required to move money non-interactively)",
    "  --base-url URL  override API host (must be a talise.io host)",
    "  --no-color      disable colored output",
    "  --quiet, -q     suppress human chatter",
    "  --help, -h      help for any command",
    "  --version, -v   print version",
    "",
    "Run `talise <command> --help` for details on a command.",
  );
  return lines.join("\n");
}

function commandHelp(c: Command): string {
  return [`talise ${c.name} — ${c.summary}`, "", "Usage", `  talise ${c.usage}`, "", c.help].join("\n");
}

// ── Session move helpers ────────────────────────────────────────────────────
function sessionExport(mode: OutputMode): void {
  const s = loadSession();
  if (!s) throw new Error("no session to export — run `talise login` first");
  process.stdout.write(Buffer.from(JSON.stringify(s)).toString("base64") + "\n");
  note(mode, "set this on the agent host as TALISE_SESSION, or `talise session import`");
}

function sessionImport(mode: OutputMode, arg?: string): void {
  const raw = arg ? (isFile(arg) ? readFileSync(arg, "utf8") : arg) : readFileSync(0, "utf8");
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

// ── Entry ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Version, anywhere.
  if (argv.includes("--version") || argv.includes("-v") || argv[0] === "version") {
    process.stdout.write(`talise ${version()}\n`);
    return;
  }
  // Bare invocation / explicit help.
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    // `talise help <cmd>` → command help.
    const target = argv[0] === "help" ? argv[1] : undefined;
    const c = target ? BY_NAME.get(target) : undefined;
    process.stdout.write((c ? commandHelp(c) : topHelp()) + "\n");
    return;
  }

  const cmdName = argv[0]!;
  const command = BY_NAME.get(cmdName);
  if (!command) {
    throw new Error(`unknown command: ${cmdName}\nrun \`talise help\` to see all commands`);
  }

  const flags = parseArgs(argv.slice(1));
  if (flags.noColor) disableColor();
  // Per-command help: `talise <cmd> --help`.
  if (flags.help) {
    process.stdout.write(commandHelp(command) + "\n");
    return;
  }

  const mode: OutputMode = { json: flags.json, quiet: flags.quiet, yes: flags.yes };
  const baseUrl = resolveBaseUrl(flags.baseUrl);
  await command.run({ baseUrl, mode, flags });
}

main().catch((e: unknown) => {
  const mode: OutputMode = {
    json: process.argv.includes("--json"),
    quiet: process.argv.includes("--quiet"),
    yes: false,
  };
  if (process.argv.includes("--no-color")) disableColor();
  const err = e as { message?: string; code?: string };
  fail(mode, err.message ?? String(e), err.code);
});
