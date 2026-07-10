import { describe, expect, it } from "vitest";
import { shortAddr, usd } from "../src/format.ts";

describe("shortAddr", () => {
  it("elides the middle of a 0x address", () => {
    const a = "0x8a319488de2a8043a7b503d4a906ce5feedb793787bdb9a63bc6327d46310cdb";
    const s = shortAddr(a);
    expect(s.startsWith("0x8a31")).toBe(true);
    expect(s.endsWith("0cdb")).toBe(true);
    expect(s).toContain("…");
    expect(s.length).toBeLessThan(a.length);
  });

  it("leaves a short string untouched", () => {
    expect(shortAddr("0xabc")).toBe("0xabc");
  });
});

describe("usd", () => {
  it("formats with two decimals and a $ sign", () => {
    expect(usd(0)).toBe("$0.00");
    expect(usd(1)).toBe("$1.00");
    expect(usd(1234.5)).toBe("$1,234.50");
  });
});
