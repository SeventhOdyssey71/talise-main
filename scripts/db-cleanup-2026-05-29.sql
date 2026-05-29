-- =====================================================================
-- Talise waitlist cleanup — 2026-05-29
--
-- Purpose:
--   Wipe two specific `waitlist_signups` rows so the humans behind them
--   can re-join from scratch (re-enter email + re-claim a handle).
--
-- Both statements are idempotent: re-running on an already-clean DB is
-- a no-op (DELETE matching zero rows). Safe to replay.
--
-- Safe to delete this file after: 2026-06-29 (30 days from the run).
-- =====================================================================

-- (1) Remove the waitlist signup tied to optionalsele@gmail.com so the
--     user can re-join with a fresh handle. Email is the natural key on
--     `waitlist_signups`.
DELETE FROM waitlist_signups WHERE email = 'optionalsele@gmail.com';

-- (2) Free up the `deeplens` handle reservation regardless of which
--     email currently holds it. NOTE: only frees the DB reservation — if
--     a `deeplens.talise.sui` SuiNS NFT was already minted on chain,
--     it is NOT burned by this script.
DELETE FROM waitlist_signups WHERE claimed_handle = 'deeplens';
