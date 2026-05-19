import { NextResponse } from "next/server";
import { readSessionEntryId } from "@/lib/session";
import { userById } from "@/lib/db";
import {
  callProver,
  readSigningCookie,
} from "@/lib/zksigner";
import { shinamiCreateProof, shinamiEnabled } from "@/lib/shinami";
import { decodeJwt } from "@/lib/zklogin";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64 } from "@mysten/sui/utils";
import {
  genAddressSeed,
  getExtendedEphemeralPublicKey,
} from "@mysten/sui/zklogin";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { getT2000 } from "@/lib/t2000";
import type { ZkLoginProof } from "@t2000/sdk";

export const runtime = "nodejs";

/**
 * POST /api/t2000/execute
 *
 * Runs an agentic-finance op via `@t2000/sdk` (NAVI lending + Cetus
 * aggregator). The SDK builds the PTB internally, signs with a zkLogin
 * signer, and broadcasts — we just hydrate the signer from the user's
 * session and forward the call.
 *
 * Client must POST the ephemeral PRIVATE key (bech32 `suiprivkey1…`) so we
 * can rebuild the zkLogin signer here. The ephemeral key is a one-shot
 * 55-minute artifact — security tradeoff documented in WEB_ARCHITECTURE.md.
 * For a stricter setup, run the SDK browser-side via `@t2000/sdk/browser`.
 */
export async function POST(req: Request) {
  const userId = await readSessionEntryId();
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const signing = await readSigningCookie();
  if (!signing) {
    return NextResponse.json({ error: "No active sign-in" }, { status: 401 });
  }

  type Body = {
    op?: "save" | "swap" | "withdraw" | "borrow" | "repay" | "stakeVSui";
    amount?: number;
    asset?: string;
    from?: string;
    to?: string;
    ephemeralPrivateKey?: string;
    ephemeralPubKeyB64?: string;
    maxEpoch?: number;
    randomness?: string;
  };
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (
    !body.op ||
    typeof body.amount !== "number" ||
    !body.ephemeralPrivateKey ||
    !body.ephemeralPubKeyB64 ||
    !body.randomness ||
    typeof body.maxEpoch !== "number"
  ) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  try {
    const eph = Ed25519Keypair.fromSecretKey(body.ephemeralPrivateKey);
    const pubKey = new Ed25519PublicKey(fromBase64(body.ephemeralPubKeyB64));
    const extendedEphemeralPublicKey = getExtendedEphemeralPublicKey(pubKey);

    // Use Shinami when configured (mainnet path); otherwise fall back to
    // Mysten's public prover (testnet-friendly, mainnet-audience-gated).
    const proof = shinamiEnabled()
      ? await shinamiCreateProof({
          jwt: signing.jwt,
          maxEpoch: body.maxEpoch,
          extendedEphemeralPublicKey,
          jwtRandomness: body.randomness,
          salt: signing.salt,
        })
      : await callProver({
          jwt: signing.jwt,
          extendedEphemeralPublicKey,
          maxEpoch: body.maxEpoch,
          jwtRandomness: body.randomness,
          salt: signing.salt,
          keyClaimName: "sub",
        });

    const claims = decodeJwt(signing.jwt);
    const addressSeed = genAddressSeed(
      BigInt(signing.salt),
      "sub",
      claims.sub,
      claims.aud
    ).toString();

    const zkProof: ZkLoginProof = { ...proof, addressSeed };

    const t2000 = getT2000({
      ephemeralKeypair: eph,
      zkProof,
      userAddress: user.sui_address,
      maxEpoch: body.maxEpoch,
    });

    const amount = body.amount;
    type ExecResult = { digest?: string } & Record<string, unknown>;
    let result: ExecResult;

    switch (body.op) {
      case "save":
        result = (await t2000.save({
          amount,
          asset: (body.asset as never) ?? undefined,
        })) as unknown as ExecResult;
        break;
      case "swap":
        if (!body.from || !body.to) {
          return NextResponse.json(
            { error: "swap requires `from` and `to`" },
            { status: 400 }
          );
        }
        result = (await t2000.swap({
          from: body.from,
          to: body.to,
          amount,
        })) as unknown as ExecResult;
        break;
      case "withdraw":
        result = (await t2000.withdraw({
          amount,
          asset: (body.asset as never) ?? undefined,
        })) as unknown as ExecResult;
        break;
      case "borrow":
        result = (await t2000.borrow({
          amount,
          asset: (body.asset as never) ?? undefined,
        })) as unknown as ExecResult;
        break;
      case "repay":
        result = (await t2000.repay({
          amount,
          asset: (body.asset as never) ?? undefined,
        })) as unknown as ExecResult;
        break;
      case "stakeVSui":
        result = (await t2000.stakeVSui({ amount })) as unknown as ExecResult;
        break;
      default:
        return NextResponse.json(
          { error: `unknown op: ${body.op}` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      digest: result.digest ?? "",
      result,
    });
  } catch (err) {
    const msg = (err as Error).message ?? "execute failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
