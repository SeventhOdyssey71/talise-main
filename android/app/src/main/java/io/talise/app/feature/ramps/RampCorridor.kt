package io.talise.app.feature.ramps

/**
 * A fiat corridor for the ramps (add money / cash out), ported 1:1 from iOS
 * `RampCorridor.swift`. Each row is a country + its currency + a flag, plus how
 * Talise serves it:
 *
 *   - [Availability.Bridge] - live via Bridge (USD/EUR/GBP/MXN/BRL/COP). Bridge
 *     moves fiat <-> USDsui DIRECTLY on Sui, both directions.
 *   - [Availability.Local]  - served by a dedicated local rail (Nigeria/NGN via
 *     Linq), off-ramp only today.
 *   - [Availability.Soon]   - known corridor, not yet bookable; shown disabled so
 *     the map of "where Talise is going" is honest.
 */
data class RampCorridor(
    /** ISO 3166-1 alpha-2 (e.g. "US", "NG"); "EU" for the Eurozone. */
    val code: String,
    /** Display name ("United States"). */
    val name: String,
    /** ISO 4217 fiat currency ("USD"). */
    val currencyCode: String,
    val availability: Availability,
    /** Which directions this corridor supports. */
    val onramp: Boolean,
    val offramp: Boolean,
) {
    val id: String get() = code

    enum class Availability { Bridge, Local, Soon }

    val isAvailable: Boolean get() = availability != Availability.Soon

    /** Short rail label for the row subtitle. */
    val railLabel: String
        get() = when (availability) {
            Availability.Bridge -> "Bank transfer · USDC on Sui"
            Availability.Local -> "Local bank"
            Availability.Soon -> "Coming soon"
        }
}

/**
 * The corridor catalogue, mirroring iOS `RampCorridors`. Available rows are
 * first-class; "soon" rows keep the picker honest about coverage without
 * pretending they work.
 */
object RampCorridors {
    /** Bridge fiat corridors (live when Bridge is configured). Bridge delivers
     *  USDsui on Sui directly, no swap, for both add-money and cash-out. */
    val all: List<RampCorridor> = listOf(
        // -- Live via Bridge (USD/EUR/GBP) --
        RampCorridor("US", "United States", "USD", RampCorridor.Availability.Bridge, onramp = true, offramp = true),
        // GBP add-money is live (virtual account); GBP cash-out (Faster
        // Payments) isn't wired yet -> onramp only.
        RampCorridor("GB", "United Kingdom", "GBP", RampCorridor.Availability.Bridge, onramp = true, offramp = false),
        // -- Live via a local rail (Linq) --
        RampCorridor("NG", "Nigeria", "NGN", RampCorridor.Availability.Local, onramp = false, offramp = true),
        // -- On the map, not yet bookable --
        RampCorridor("KE", "Kenya", "KES", RampCorridor.Availability.Soon, onramp = false, offramp = false),
        RampCorridor("GH", "Ghana", "GHS", RampCorridor.Availability.Soon, onramp = false, offramp = false),
        RampCorridor("ZA", "South Africa", "ZAR", RampCorridor.Availability.Soon, onramp = false, offramp = false),
        RampCorridor("PH", "Philippines", "PHP", RampCorridor.Availability.Soon, onramp = false, offramp = false),
        RampCorridor("IN", "India", "INR", RampCorridor.Availability.Soon, onramp = false, offramp = false),
        RampCorridor("ID", "Indonesia", "IDR", RampCorridor.Availability.Soon, onramp = false, offramp = false),
        RampCorridor("VN", "Vietnam", "VND", RampCorridor.Availability.Soon, onramp = false, offramp = false),
        RampCorridor("EG", "Egypt", "EGP", RampCorridor.Availability.Soon, onramp = false, offramp = false),
    )

    /**
     * Corridors that support a given direction, available ones first, "soon"
     * last, both groups alphabetical by name. Mirrors iOS `forDirection`.
     */
    fun forDirection(
        direction: RampDirection,
        userCountry: String?,
    ): Pair<List<RampCorridor>, List<RampCorridor>> {
        // Nigeria-first: an unset/empty country defaults to NG so a user who
        // never picked one still gets Nigerian cash-out (the live rail) rather
        // than an all-"coming soon" wall.
        val raw = (userCountry ?: "").trim()
        val cc = (raw.ifEmpty { "NG" }).uppercase()
        val supports: (RampCorridor) -> Boolean = { c ->
            if (direction == RampDirection.Onramp) c.onramp else c.offramp
        }
        // A corridor is bookable NOW only if it supports the direction, its rail
        // is live, AND it matches the user's country:
        //   - local (Linq/Nigeria) -> only for a user whose country is that code
        //     (a Nigerian sees Nigeria cash-out; everyone else -> coming soon).
        //   - Bridge corridors -> only once RampFlags.bridgeLive is on, and for
        //     a matching-country user (EUR covers the whole Eurozone).
        // Everything else falls to "coming soon".
        val live: (RampCorridor) -> Boolean = { c ->
            when (c.availability) {
                RampCorridor.Availability.Local -> cc == c.code
                RampCorridor.Availability.Bridge ->
                    if (!RampFlags.bridgeLive) false
                    // Cash-out (off-ramp) is country-agnostic: anyone holding
                    // dollars can pay out to a USD/EUR bank, so we don't gate it on
                    // the user's residence. Add-money (on-ramp) stays matched to the
                    // user's country (their local funding rail).
                    else if (direction == RampDirection.Offramp) true else c.code == cc
                RampCorridor.Availability.Soon -> false
            }
        }
        val bookable: (RampCorridor) -> Boolean = { live(it) && supports(it) }
        val available = all.filter(bookable).sortedBy { it.name }
        val soon = all.filter { !bookable(it) }.sortedBy { it.name }
        return available to soon
    }
}

enum class RampDirection {
    Onramp,  // add money: fiat -> USDsui
    Offramp, // cash out: USDsui -> fiat
}

/**
 * Feature gating for the ramps, mirroring iOS `RampFlags`. Until the Bridge
 * account is live (KYB approved + API key + webhook), only Nigeria's local rail
 * (Linq) is bookable, the Bridge corridors (US/EU/GB/...) show as "coming soon".
 * Flip [bridgeLive] to true to switch them on with no other code change.
 */
object RampFlags {
    // LOCKED for now: Bridge corridors (US cash-out / add-money) hidden while
    // KYC + the US flow are paused. Flip back to true to re-enable.
    const val bridgeLive = false
}
