import { describe, expect, it } from "vitest";
import { resolveRepositoryRef } from "./gitlab-branches";

describe("resolveRepositoryRef", () => {
  const branches = [
    { name: "main", default: true },
    { name: "develop", default: false },
  ];

  it("keeps a requested ref that still exists", () => {
    expect(resolveRepositoryRef("develop", branches)).toBe("develop");
  });

  it("falls back to the current default when the requested ref was deleted", () => {
    expect(resolveRepositoryRef("master", branches)).toBe("main");
  });

  it("returns no ref for a repository without branches", () => {
    expect(resolveRepositoryRef("master", [])).toBe("");
  });
});
