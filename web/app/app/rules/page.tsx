import { RulesView } from "@/components/app/rules/RulesView";

/**
 * /app/rules — programmable money / automations.
 *
 * Scheduled sends drawn from a Talise-controlled Rules Pocket escrow. Gated
 * server-side until the escrow key is set; when off, RulesView renders a clean
 * "coming soon" state. All client-side, talking to /api/rules.
 */
export default function RulesPage() {
  return <RulesView />;
}
