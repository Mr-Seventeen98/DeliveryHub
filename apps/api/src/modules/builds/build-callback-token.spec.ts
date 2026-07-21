import { describe, expect, it } from "vitest";
import { deriveTeamCityCallbackToken } from "./build-callback-token";

describe("deriveTeamCityCallbackToken", () => {
  it("is stable for one connection and isolated between connections", () => {
    const secret = "a-secure-application-secret-with-32-characters";
    const first = deriveTeamCityCallbackToken(secret, "connection-a");

    expect(first).toBe(
      deriveTeamCityCallbackToken(secret, "connection-a"),
    );
    expect(first).not.toBe(
      deriveTeamCityCallbackToken(secret, "connection-b"),
    );
    expect(first.length).toBeGreaterThanOrEqual(40);
  });
});
