import taliseTemplate from './talise.json'

// gasBudgetMax (20_000_000 MIST ≈ 0.02 SUI) covers normal PTBs
// (send / vault / auto_swap) with headroom. Bump only if a legit
// flow simulates over this cap. `targets` is templated with
// `__TALISE_PACKAGE_ID__` so the sponsor only signs for our own
// Move modules at runtime. See `resolveSponsorPolicies`.

const PACKAGE_ID_TOKEN = '__TALISE_PACKAGE_ID__'

export type RawSponsorPolicy = Record<string, unknown>

/**
 * Build the runtime policy list from the templated JSON. Substitutes
 * `__TALISE_PACKAGE_ID__` in `targets` with the configured Talise
 * Move package id. If `packageId` is missing or empty, the Talise
 * policy is dropped. Sponsor will then reject every Talise tx
 * instead of falling back to a wildcard, which is the safer default.
 */
export function resolveSponsorPolicies(packageId: string | undefined): RawSponsorPolicy[] {
  if (!packageId || packageId.trim().length === 0) return []
  const pkg = packageId.trim()
  // structuredClone keeps the import immutable across requests.
  const cloned = structuredClone(taliseTemplate) as RawSponsorPolicy
  if (Array.isArray((cloned as { targets?: unknown }).targets)) {
    const targets = (cloned as { targets: unknown[] }).targets.map((t) =>
      typeof t === 'string' ? t.split(PACKAGE_ID_TOKEN).join(pkg) : t,
    )
    ;(cloned as { targets: unknown[] }).targets = targets
  }
  return [cloned]
}

// Default export kept for back-compat with code that imports the
// raw JSON list. Callers that need the resolved package-id version
// should call `resolveSponsorPolicies` per-request.
const sponsorPolicies: RawSponsorPolicy[] = [taliseTemplate as RawSponsorPolicy]

export default sponsorPolicies
