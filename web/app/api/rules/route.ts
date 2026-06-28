import { NextResponse } from "next/server";
import { denyUnlessAppApproved } from "@/lib/app-access";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { rateLimitAsync } from "@/lib/rate-limit";
import { userById } from "@/lib/db";
import { resolveRecipient } from "@/lib/suins";
import { screenTransfer } from "@/lib/screening";
import {
  moneyRulesEnabled,
  moneyRulesEscrowAddress,
  createRule,
  listRules,
  type TriggerType,
  type ActionType,
} from "@/lib/money-rules";

export const runtime = "nodejs";

const ADDRESS_RE = /^0x[a-f0-9]{64}$/i;
const MAX_USD = 10_000;

/** GET /api/rules — the caller's money rules (newest first). */
export async function GET(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const denied = await denyUnlessAppApproved(userId);
  if (denied) return denied;

  const user = await userById(userId);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  if (!moneyRulesEnabled()) return NextResponse.json({ rules: [], escrowAddress: null });
  const rules = await listRules(userId);
  return NextResponse.json({ rules, escrowAddress: moneyRulesEscrowAddress() });
}

/**
 * POST /api/rules — create a money rule.
 *
 * Body: {
 *   name, trigger: 'schedule'|'on-inflow'|'threshold', action: 'send',
 *   intervalMinutes?, dayOfMonth?,          // schedule
 *   inflowMinUsd?,                          // on-inflow
 *   balanceThresholdUsd?,                   // threshold
 *   toRecipient, amountUsd                  // send action
 * }
 *
 * The rule draws from a Talise-controlled "Rules Pocket" escrow; the response
 * returns that escrow address so the client can pre-fund it over the normal
 * gasless send rail.
 */
export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const denied = await denyUnlessAppApproved(userId);
  if (denied) return denied;

  if (!moneyRulesEnabled()) {
    return NextResponse.json(
      { error: "Automated rules aren't available yet.", code: "MONEY_RULES_DISABLED" },
      { status: 503 }
    );
  }

  const rl = await rateLimitAsync({ key: `money-rule-create:user:${userId}`, limit: 20, windowSec: 3600 });
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 3600) } });
  }

  const user = await userById(userId);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  let body: {
    name?: string;
    trigger?: string;
    action?: string;
    intervalMinutes?: number;
    dayOfMonth?: number;
    inflowMinUsd?: number;
    balanceThresholdUsd?: number;
    toRecipient?: string;
    amountUsd?: number;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const triggerType = (body.trigger ?? "").trim() as TriggerType;
  const actionType = (body.action ?? "send").trim() as ActionType;
  if (triggerType !== "schedule" && triggerType !== "on-inflow" && triggerType !== "threshold") {
    return NextResponse.json({ error: "Choose a valid trigger." }, { status: 400 });
  }

  // Validate the send action (the only executable action for launch).
  const amountUsd = Number(body.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > MAX_USD) {
    return NextResponse.json({ error: "Enter a valid payout amount." }, { status: 400 });
  }

  // Resolve + screen the recipient (never trust raw input on the money path).
  const rawTo = (body.toRecipient ?? "").trim();
  if (!rawTo) return NextResponse.json({ error: "Choose who this rule pays." }, { status: 400 });
  let resolved;
  try { resolved = await resolveRecipient(rawTo); } catch { resolved = null; }
  if (!resolved || !ADDRESS_RE.test(resolved.address)) {
    return NextResponse.json({ error: `Couldn't resolve "${rawTo}".`, code: "RESOLVE_FAILED" }, { status: 400 });
  }
  const toAddress = resolved.address.toLowerCase();
  if (toAddress === user.sui_address.toLowerCase()) {
    return NextResponse.json({ error: "A rule can't pay your own wallet.", code: "SELF_RECIPIENT" }, { status: 400 });
  }

  const screen = await screenTransfer({
    senderAddr: user.sui_address,
    recipientAddr: toAddress,
    senderName: user.business_name ?? user.name,
    recipientName: null,
  });
  if (!screen.allow) {
    return NextResponse.json({ error: "That recipient was blocked by a compliance screen.", code: "SCREENING_BLOCK" }, { status: 403 });
  }

  try {
    const rule = await createRule({
      userId,
      ownerAddress: user.sui_address,
      name: (body.name ?? "").trim(),
      triggerType,
      actionType,
      intervalMinutes: body.intervalMinutes == null ? null : Number(body.intervalMinutes),
      dayOfMonth: body.dayOfMonth == null ? null : Number(body.dayOfMonth),
      inflowMinMicros: body.inflowMinUsd == null ? null : BigInt(Math.round(Number(body.inflowMinUsd) * 1e6)),
      balanceThresholdMicros: body.balanceThresholdUsd == null ? null : BigInt(Math.round(Number(body.balanceThresholdUsd) * 1e6)),
      send: {
        toAddress,
        toHandle: resolved.displayName ?? null,
        amountMicros: BigInt(Math.round(amountUsd * 1e6)),
      },
    });
    return NextResponse.json({ rule, escrowAddress: moneyRulesEscrowAddress() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? "Couldn't create the rule." }, { status: 400 });
  }
}
