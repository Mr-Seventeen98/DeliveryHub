import { describe, expect, it } from "vitest";
import { normalizeRepositoryUrl } from "./teamcity-repository";

describe("normalizeRepositoryUrl", () => {
  it.each([
    [
      "https://gitlab.example.com/Group/Project.git",
      "gitlab.example.com/group/project",
    ],
    [
      "git@gitlab.example.com:Group/Project.git",
      "gitlab.example.com/group/project",
    ],
    [
      "ssh://git@gitlab.example.com/Group/Project.git",
      "gitlab.example.com/group/project",
    ],
  ])("normalizes %s", (value, expected) => {
    expect(normalizeRepositoryUrl(value)?.full).toBe(expected);
  });
});
