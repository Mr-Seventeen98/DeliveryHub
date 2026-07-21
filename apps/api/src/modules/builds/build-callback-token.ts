import { createHmac } from "node:crypto";

export function deriveTeamCityCallbackToken(
  appSecret: string,
  teamCityConnectionId: string,
): string {
  return createHmac("sha256", appSecret)
    .update(`teamcity-callback:${teamCityConnectionId}`)
    .digest("base64url");
}
