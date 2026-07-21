import { describe, expect, it } from "vitest";
import { normalizeTencentCloudDate } from "./tencent-date";

describe("normalizeTencentCloudDate", () => {
  it("does not apply Tencent Cloud's numeric offset and abbreviation twice", () => {
    expect(normalizeTencentCloudDate("2026-07-28 11:38:28 +0800 CST")).toBe(
      "2026-07-28T03:38:28.000Z",
    );
  });

  it("keeps standard ISO timestamps at the same instant", () => {
    expect(normalizeTencentCloudDate("2026-07-28T03:38:28.000Z")).toBe(
      "2026-07-28T03:38:28.000Z",
    );
  });

  it("returns null for missing or invalid timestamps", () => {
    expect(normalizeTencentCloudDate(null)).toBeNull();
    expect(normalizeTencentCloudDate("not-a-date")).toBeNull();
  });
});
