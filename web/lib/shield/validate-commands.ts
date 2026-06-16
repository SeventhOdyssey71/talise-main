import "server-only";

/**
 * THE relayer security control (ported from Vortex's command-allowlist).
 *
 * The relayer signs as gas owner (via Onara) and sets itself as `sender` on
 * a user-supplied PTB. That is a blank cheque UNLESS the PTB shape is pinned
 * exactly. An unconstrained relayer is a drain hole: a malicious `txBytes`
 * could call ANY Move function with the relayer as sender. So before we ever
 * hand the bytes to Onara we parse the serialized PTB and assert it matches —
 * to the command — the shielded `transact` / `transact_with_account` shape:
 *
 *   • EXACTLY ONE `MoveCall`, and it targets
 *     `${SHIELD_PKG}::shielded_pool::transact[_with_account]`
 *     with the package id pinned via `normalizeSuiAddress` (no other package,
 *     no other module, no other function).
 *   • Only the allowed preceding constructor / coin-glue commands
 *     (SplitCoins, MergeCoins, MakeMoveVec) — everything else (TransferObjects,
 *     Publish, Upgrade, Intents, a second MoveCall, …) is rejected.
 *   • `ExtData.relayer == OUR relayer address` and `ExtData.relayer_fee <= MAX`.
 *     The proof + ext_data are constructed client-side; without this check a
 *     user could name a different relayer (griefing) or set an enormous fee
 *     that the on-chain `transact` would happily pay OUT of the pool to the
 *     attacker.
 *
 * NOTE on `proof::new` / `ext_data::new`: in the live PTB these are Move
 * constructor calls. But each is a MoveCall, and the on-chain `transact`
 * takes `Proof` + `ExtData` BY VALUE — so a real relayed PTB would contain
 * MULTIPLE MoveCalls (proof::new, ext_data::new, shielded_pool::transact).
 * To keep this control airtight we DO allow `proof::new` and `ext_data::new`
 * MoveCalls, but ONLY against the SAME pinned package, and we still require
 * EXACTLY ONE call to `shielded_pool::transact[_with_account]`. Any MoveCall
 * to a different package/module/function is rejected. This is the seam where
 * the ExtData arguments are read (see `extractExtData`).
 */

import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, normalizeSuiAddress } from "@mysten/sui/utils";
import { bcs } from "@mysten/sui/bcs";
import {
  shieldPackageId,
  shieldRelayerAddress,
  shieldMaxRelayerFee,
  SHIELD_MODULE,
} from "./relayer-config";

// ── Allowlists ───────────────────────────────────────────────────────────

/** The single terminal MoveCall function names allowed on the pinned module. */
const TRANSACT_FNS = new Set(["transact", "transact_with_account"]);

/** Constructor MoveCalls allowed against the pinned package (assemble Proof/ExtData). */
const CONSTRUCTOR_TARGETS = new Set([
  "proof::new",
  "ext_data::new",
]);

/**
 * Non-MoveCall command kinds permitted to PRECEDE the transact call. These are
 * pure coin/vector glue with no ability to move value to an arbitrary address.
 * Notably ABSENT: TransferObjects (could send the deposit coin anywhere),
 * Publish, Upgrade, MakeMoveVec is allowed (used to build the Receiving vector
 * for the with-account path), $Intent (opaque — reject).
 */
const ALLOWED_NON_MOVECALL_KINDS = new Set([
  "SplitCoins",
  "MergeCoins",
  "MakeMoveVec",
]);

export class ShieldValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShieldValidationError";
  }
}

export type ValidatedTransact = {
  /** "transact" | "transact_with_account" */
  fn: string;
  /** The relayer-fee read out of the ExtData pure arg, when statically known. */
  relayerFee: bigint | null;
  /** The relayer address read out of the ExtData pure arg, when statically known. */
  relayer: string | null;
};

type TxData = ReturnType<Transaction["getData"]>;
type Command = TxData["commands"][number];
type Input = TxData["inputs"][number];

/**
 * Parse the serialized PTB, assert it is EXACTLY a shielded `transact` shape,
 * and assert the ExtData relayer + fee. Throws `ShieldValidationError` on ANY
 * deviation — the relay route maps that to a 400 and NEVER forwards the bytes.
 *
 * `txBytes` is the base64 BCS-serialized TransactionKind/Transaction the client
 * built (same `toBase64(tx.build(...))` shape the send routes produce).
 */
export function validateTransactCommands(txBytesB64: string): ValidatedTransact {
  const pkg = shieldPackageId();
  const relayer = shieldRelayerAddress();
  if (!pkg || !relayer) {
    // Fail-closed: with no pinned package / relayer we cannot enforce anything.
    throw new ShieldValidationError("shield relayer not configured");
  }

  let data: TxData;
  try {
    const bytes = fromBase64(txBytesB64);
    data = Transaction.from(bytes).getData();
  } catch (e) {
    throw new ShieldValidationError(
      `unparseable transaction bytes: ${(e as Error).message}`
    );
  }

  const commands = data.commands ?? [];
  if (commands.length === 0) {
    throw new ShieldValidationError("empty PTB");
  }
  // Hard ceiling: a legit shielded tx is proof::new + ext_data::new +
  // (optional split/merge/makevec glue) + one transact. A handful of commands.
  if (commands.length > 12) {
    throw new ShieldValidationError(
      `too many commands (${commands.length}); shielded transact is a small fixed PTB`
    );
  }

  let transactCount = 0;
  let transactCmd: Command | null = null;

  for (const cmd of commands) {
    const kind = cmd.$kind;

    if (kind === "MoveCall") {
      const mc = cmd.MoveCall;
      const cmdPkg = normalizePkg(mc.package);
      // Every MoveCall MUST be against OUR pinned package — no exceptions.
      if (cmdPkg !== pkg) {
        throw new ShieldValidationError(
          `MoveCall to foreign package ${cmdPkg} (only ${pkg} allowed)`
        );
      }
      const modFn = `${mc.module}::${mc.function}`;

      if (mc.module === SHIELD_MODULE && TRANSACT_FNS.has(mc.function)) {
        transactCount += 1;
        transactCmd = cmd;
        continue;
      }
      if (CONSTRUCTOR_TARGETS.has(modFn)) {
        // proof::new / ext_data::new — allowed assembly calls.
        continue;
      }
      throw new ShieldValidationError(
        `disallowed MoveCall ${cmdPkg}::${modFn}`
      );
    }

    // Non-MoveCall command — must be on the coin/vector-glue allowlist.
    if (!ALLOWED_NON_MOVECALL_KINDS.has(kind)) {
      throw new ShieldValidationError(`disallowed command kind ${kind}`);
    }
  }

  if (transactCount !== 1 || !transactCmd) {
    throw new ShieldValidationError(
      `expected exactly one shielded_pool::transact[_with_account], found ${transactCount}`
    );
  }

  const mc = transactCmd.MoveCall;

  // ── ExtData relayer + fee assertions ────────────────────────────────────
  // The `transact` signature is:
  //   transact(self, registry, deposit: Coin, proof: Proof, ext_data: ExtData, ctx)
  // ExtData is assembled by an `ext_data::new(value, value_sign, relayer,
  // relayer_fee, enc0, enc1)` MoveCall. We locate that call and read its
  // `relayer` + `relayer_fee` pure inputs. If the ExtData was instead passed as
  // an opaque pre-serialized arg we cannot statically verify it → reject,
  // because skipping the check would defeat the whole control.
  const ext = extractExtData(commands, data.inputs, pkg);

  if (ext.relayer === null || ext.relayerFee === null) {
    throw new ShieldValidationError(
      "could not statically resolve ExtData.relayer / relayer_fee from the PTB"
    );
  }
  if (ext.relayer !== relayer) {
    throw new ShieldValidationError(
      `ExtData.relayer ${ext.relayer} != our relayer ${relayer}`
    );
  }
  const maxFee = shieldMaxRelayerFee();
  if (ext.relayerFee > maxFee) {
    throw new ShieldValidationError(
      `ExtData.relayer_fee ${ext.relayerFee} exceeds max ${maxFee}`
    );
  }

  return { fn: mc.function, relayer: ext.relayer, relayerFee: ext.relayerFee };
}

// ── ExtData extraction ─────────────────────────────────────────────────────

type ExtDataRead = { relayer: string | null; relayerFee: bigint | null };

/**
 * Find the `ext_data::new(...)` MoveCall and decode its `relayer` (arg index 2)
 * + `relayer_fee` (arg index 3) pure inputs. Argument order matches
 * `ext_data::new(value, value_sign, relayer, relayer_fee, enc0, enc1)`.
 *
 * Returns nulls if the ExtData isn't assembled by an in-PTB `ext_data::new`
 * call (the caller treats nulls as a hard reject).
 */
function extractExtData(
  commands: Command[],
  inputs: Input[],
  pkg: string
): ExtDataRead {
  const newCall = commands.find(
    (c) =>
      c.$kind === "MoveCall" &&
      normalizePkg(c.MoveCall.package) === pkg &&
      c.MoveCall.module === "ext_data" &&
      c.MoveCall.function === "new"
  );
  if (!newCall || newCall.$kind !== "MoveCall") {
    return { relayer: null, relayerFee: null };
  }

  const args = newCall.MoveCall.arguments;
  // ext_data::new(value, value_sign, relayer, relayer_fee, enc0, enc1)
  const relayerArg = args[2];
  const feeArg = args[3];

  const relayer = decodeAddressInput(relayerArg, inputs);
  const relayerFee = decodeU64Input(feeArg, inputs);
  return { relayer, relayerFee };
}

type MoveCallCommand = Extract<Command, { $kind: "MoveCall" }>;
type Arg = MoveCallCommand["MoveCall"]["arguments"][number];

/** Resolve a MoveCall argument back to its Pure input bytes, if it is one. */
function pureBytes(arg: Arg | undefined, inputs: Input[]): Uint8Array | null {
  if (!arg || arg.$kind !== "Input") return null;
  const input = inputs[arg.Input];
  if (!input) return null;
  if (input.$kind === "Pure") {
    try {
      return fromBase64(input.Pure.bytes);
    } catch {
      return null;
    }
  }
  // UnresolvedPure values can't be byte-decoded reliably here; reject upstream.
  return null;
}

function decodeAddressInput(arg: Arg | undefined, inputs: Input[]): string | null {
  const b = pureBytes(arg, inputs);
  if (!b) return null;
  try {
    return bcs.Address.parse(b);
  } catch {
    return null;
  }
}

function decodeU64Input(arg: Arg | undefined, inputs: Input[]): bigint | null {
  const b = pureBytes(arg, inputs);
  if (!b) return null;
  try {
    return BigInt(bcs.u64().parse(b));
  } catch {
    return null;
  }
}

/** Normalize a command's package id to the same 0x-prefixed 64-hex form. */
function normalizePkg(pkg: string): string {
  // `getData()` already returns normalized 0x… addresses, but normalize again
  // defensively so the equality check against `shieldPackageId()` is exact.
  try {
    return normalizeSuiAddress(pkg);
  } catch {
    return pkg;
  }
}
