// Cible zkLogin bridge.
//
// Stateless. Holds no secrets except an optional sponsor Ed25519 key loaded
// at startup from env. Performs the cryptographic operations the iOS app
// can't do natively (no Poseidon, no Blake2b, no BCS encoder in Swift's
// standard libraries) plus PTB byte construction and sponsored-tx co-signing.
//
// Endpoints:
//   POST /zklogin/address — given a Google JWT + salt, return the Sui address
//   POST /zklogin/sign    — given tx bytes + ZK proof inputs + an ephemeral
//                           signature, return a fully-formed zkLoginSignature
//   POST /tx/build        — given a MoveCall spec, return base64 PTB bytes
//   POST /sponsor         — given unsigned tx kind + user zkLoginSignature,
//                           attach gas payment, co-sign with sponsor key,
//                           return final tx bytes + sponsor signature.
//
// Run:
//   cd bridge
//   npm install
//   node server.js

import 'dotenv/config';
import express from 'express';
import { jwtToAddress, getExtendedEphemeralPublicKey, genAddressSeed, getZkLoginSignature } from '@mysten/zklogin';
import { fromB64, toB64 } from '@mysten/sui/utils';
import { Ed25519PublicKey, Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const app = express();
app.use(express.json({ limit: '512kb' }));

const PORT = process.env.PORT || 8787;
const RPC_URL = process.env.SUI_RPC_URL || getFullnodeUrl('testnet');

const client = new SuiClient({ url: RPC_URL });

// Sponsor keypair is optional. /sponsor returns a clear error if absent.
let sponsorKeypair = null;
let sponsorAddress = null;
const sponsorKeyB64 = process.env.SPONSOR_PRIVATE_KEY_B64;
if (sponsorKeyB64 && sponsorKeyB64.length > 0) {
  try {
    const raw = fromB64(sponsorKeyB64);
    // Ed25519Keypair.fromSecretKey expects the 32-byte seed.
    const seed = raw.length === 33 ? raw.slice(1) : raw;
    sponsorKeypair = Ed25519Keypair.fromSecretKey(seed);
    sponsorAddress = sponsorKeypair.toSuiAddress();
    console.log(`sponsor key loaded: ${sponsorAddress}`);
  } catch (err) {
    console.warn(`failed to load sponsor key: ${err?.message ?? err}`);
    sponsorKeypair = null;
    sponsorAddress = null;
  }
}

// CORS for local dev. Tighten this for production.
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.options('*', (_req, res) => res.sendStatus(204));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'cible-zklogin-bridge',
    sponsor: sponsorAddress ? { address: sponsorAddress } : null,
  });
});

// ---------- address derivation ----------

app.post('/zklogin/address', async (req, res) => {
  try {
    const { jwt, salt, keyClaimName } = req.body || {};
    if (typeof jwt !== 'string' || typeof salt !== 'string') {
      return res.status(400).json({ error: 'jwt and salt are required strings' });
    }
    const claim = (typeof keyClaimName === 'string' && keyClaimName.length > 0)
      ? keyClaimName
      : 'sub';

    const address = jwtToAddress(jwt, salt, { keyClaimName: claim });
    return res.json({ address });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
});

// ---------- signature wrapping ----------
//
// The iOS app:
//   1) Has an ephemeral Ed25519 keypair locally.
//   2) Builds the unsigned tx bytes (PTB serialized via Sui SDK or your code).
//   3) Signs the tx bytes with the ephemeral private key → ephemeralSignature.
//   4) Calls Mysten's prover to get the ZK proof.
//   5) POSTs everything here to wrap into a full zkLoginSignature.
//
// We return a base64 zkLoginSignature the iOS app can pass to
// `sui_executeTransactionBlock` as the signature.

app.post('/zklogin/sign', async (req, res) => {
  try {
    const {
      jwt,
      salt,
      ephemeralPubKeyB64,
      maxEpoch,
      jwtRandomness,
      proof,            // returned by Mysten's prover
      userSignatureB64, // ephemeral signature of the tx bytes, base64
      keyClaimName,
    } = req.body || {};

    if (!jwt || !salt || !proof || !userSignatureB64 || !ephemeralPubKeyB64) {
      return res.status(400).json({ error: 'missing required fields' });
    }

    // Reconstruct extended ephemeral pubkey.
    const ephemeralPubKey = new Ed25519PublicKey(fromB64(ephemeralPubKeyB64));
    const extendedPk = getExtendedEphemeralPublicKey(ephemeralPubKey);

    // Derive address seed (Poseidon over claim + salt).
    const decoded = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    const claim = (typeof keyClaimName === 'string' && keyClaimName.length > 0)
      ? keyClaimName
      : 'sub';
    const claimValue = decoded[claim];
    const addressSeed = genAddressSeed(BigInt(salt), claim, claimValue, decoded.aud).toString();

    const signature = getZkLoginSignature({
      inputs: { ...proof, addressSeed },
      maxEpoch,
      userSignature: userSignatureB64,
    });

    return res.json({ signature, extendedEphemeralPublicKey: extendedPk });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
});

// ---------- PTB byte construction ----------
//
// The iOS app describes a Move call in JSON; the bridge builds and serializes
// the PTB and returns base64 tx bytes ready to be signed by the ephemeral key.
//
// If `onlyTransactionKind` is true, the returned bytes are a TransactionKind
// (no gas, no sender), suitable for handoff to /sponsor which fills in gas.

app.post('/tx/build', async (req, res) => {
  try {
    const {
      sender,
      packageId,
      module,
      function: fn,
      typeArgs,
      args,
      gasBudget,
      onlyTransactionKind,
    } = req.body || {};

    if (typeof packageId !== 'string' || typeof module !== 'string' || typeof fn !== 'string') {
      return res.status(400).json({ error: 'packageId, module, function are required strings' });
    }
    if (!Array.isArray(args)) {
      return res.status(400).json({ error: 'args must be an array' });
    }
    if (!onlyTransactionKind && typeof sender !== 'string') {
      return res.status(400).json({ error: 'sender is required unless onlyTransactionKind is true' });
    }

    const tx = new Transaction();
    if (!onlyTransactionKind) {
      tx.setSender(sender);
      if (gasBudget) tx.setGasBudget(BigInt(gasBudget));
    }

    const moveArgs = args.map((a) => {
      if (a && a.object) return tx.object(a.object);
      if (a && a.pure) {
        const t = a.pure.type;
        const v = a.pure.value;
        if (t === 'u8') return tx.pure.u8(parseInt(v, 10));
        if (t === 'u16') return tx.pure.u16(parseInt(v, 10));
        if (t === 'u32') return tx.pure.u32(parseInt(v, 10));
        if (t === 'u64') return tx.pure.u64(BigInt(v));
        if (t === 'u128') return tx.pure.u128(BigInt(v));
        if (t === 'u256') return tx.pure.u256(BigInt(v));
        if (t === 'bool') return tx.pure.bool(v === true || v === 'true');
        if (t === 'address') return tx.pure.address(v);
        if (t === 'string') return tx.pure.string(String(v));
        throw new Error('unsupported pure type: ' + t);
      }
      throw new Error('arg must have an object or pure key');
    });

    tx.moveCall({
      target: `${packageId}::${module}::${fn}`,
      typeArguments: Array.isArray(typeArgs) ? typeArgs : [],
      arguments: moveArgs,
    });

    const txBytes = await tx.build({
      client,
      onlyTransactionKind: !!onlyTransactionKind,
    });

    return res.json({ txBytesB64: toB64(txBytes) });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
});

// ---------- sponsored transaction co-signing ----------
//
// Flow:
//   1) iOS calls /tx/build with `onlyTransactionKind: true` to get tx-kind bytes.
//   2) iOS calls /sponsor with those bytes + the sender's address. The bridge
//      fetches a sponsor SUI coin, builds the full tx with sponsor as gas owner,
//      signs it with the sponsor key, and returns the final tx bytes plus the
//      sponsor signature.
//   3) iOS signs the same tx bytes with the ephemeral key, wraps via
//      /zklogin/sign into a zkLoginSignature, and submits to
//      sui_executeTransactionBlock with [userSig, sponsorSig].

app.post('/sponsor', async (req, res) => {
  try {
    if (!sponsorKeypair || !sponsorAddress) {
      return res.status(503).json({
        error: 'sponsor key not configured; set SPONSOR_PRIVATE_KEY_B64 in env',
      });
    }

    const { txKindBytesB64, sender, gasBudget } = req.body || {};
    if (typeof txKindBytesB64 !== 'string' || typeof sender !== 'string') {
      return res.status(400).json({ error: 'txKindBytesB64 and sender are required strings' });
    }

    const kindBytes = fromB64(txKindBytesB64);
    const tx = Transaction.fromKind(kindBytes);
    tx.setSender(sender);
    tx.setGasOwner(sponsorAddress);
    tx.setGasBudget(gasBudget ? BigInt(gasBudget) : 200_000_000n);

    // Pick a sponsor gas coin.
    const coins = await client.getCoins({
      owner: sponsorAddress,
      coinType: '0x2::sui::SUI',
    });
    if (!coins.data || coins.data.length === 0) {
      return res.status(503).json({ error: 'sponsor has no SUI coins; fund the sponsor address' });
    }
    tx.setGasPayment(coins.data.map((c) => ({
      objectId: c.coinObjectId,
      version: c.version,
      digest: c.digest,
    })));

    const txBytes = await tx.build({ client });
    const { signature: sponsorSignatureB64 } = await sponsorKeypair.signTransaction(txBytes);

    return res.json({
      signedTxBytesB64: toB64(txBytes),
      sponsorSignatureB64,
      sponsorAddress,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.listen(PORT, () => {
  console.log(`cible zklogin bridge listening on :${PORT}`);
});
