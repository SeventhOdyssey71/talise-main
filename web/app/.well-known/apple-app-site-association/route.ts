import { NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-static";

/**
 * Universal Links manifest. Apple fetches this at install time to learn
 * which paths the Talise app handles. We claim:
 *   - /p/<handle>   — payment links (currently `talise.io/p/<merchant>`)
 *   - /r/<code>     — referral links
 *
 * Replace TEAMID with the App ID prefix from developer.apple.com before
 * first ship. The path bundle ID below uses the same value as
 * `ios/project.yml` (io.talise.app).
 */
const TEAM_ID = process.env.APPLE_TEAM_ID ?? "TEAMID";
const BUNDLE_ID = "io.talise.app";

export async function GET() {
  return NextResponse.json({
    applinks: {
      apps: [],
      details: [
        {
          appID: `${TEAM_ID}.${BUNDLE_ID}`,
          paths: ["/p/*", "/r/*"],
        },
      ],
    },
    webcredentials: {
      apps: [`${TEAM_ID}.${BUNDLE_ID}`],
    },
  }, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
