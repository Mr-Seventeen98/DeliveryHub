import { describe, expect, it } from "vitest";
import { analyzeComposeContent } from "./compose-analysis";

describe("analyzeComposeContent", () => {
  it("detects Compose services", async () => {
    expect(
      await analyzeComposeContent(`
services:
  web:
    image: \${WEB_IMAGE}
  worker:
    image: \${WORKER_IMAGE:-example/worker:latest}
`),
    ).toEqual([{ name: "web" }, { name: "worker" }]);
  });

  it("detects services using fixed images", async () => {
    expect(
      await analyzeComposeContent(
        "services:\n  api:\n    image: example/api:latest\n",
      ),
    ).toEqual([{ name: "api" }]);
  });

  it("returns no services for invalid YAML", async () => {
    await expect(analyzeComposeContent("services: [")).resolves.toEqual([]);
  });
});
