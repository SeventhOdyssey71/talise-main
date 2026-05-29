
import { it } from "vitest";
import { getRecentActivity } from "../../lib/activity";

it("probe", async () => {
  const entries = await getRecentActivity("0x9df9ed63122824b2c77e52370bd2b9897df44f98c780f355702945f8aa923285", 5, {
    includeNonTalise: true,
    vaultId: null,
  });
  console.log("__PROBE_RESULT__", JSON.stringify({
    addr: "0x9df9ed63122824b2c77e52370bd2b9897df44f98c780f355702945f8aa923285",
    limit: 5,
    count: entries.length,
    entries,
  }, null, 2));
}, 60_000);
