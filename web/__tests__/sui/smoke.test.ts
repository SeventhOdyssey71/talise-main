/**
 * Smoke test for the integration harness. Verifies the harness wiring works
 * end-to-end against mainnet — if this passes, the harness is healthy and
 * Phase 4 can layer concrete migration assertions on top.
 */

import { describe, it, expect } from "vitest";
import { getGrpcClient, KNOWN_MAINNET_ADDRESS } from "./harness";

describe("sui integration harness", () => {
  it("can fetch the system state object via gRPC", async () => {
    const client = getGrpcClient();
    const res = await client.getObject({ objectId: KNOWN_MAINNET_ADDRESS });
    expect(res).not.toBeNull();
    expect(res).toBeDefined();
    expect(res.object).toBeDefined();
    expect(res.object.objectId).toBe(KNOWN_MAINNET_ADDRESS);
  }, 30_000);
});
