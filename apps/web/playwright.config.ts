/** 本地 UI 回归使用独立端口和纯合成 API；不登录实际 GitLab/TC/TCR，也不写部署数据。 */
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  retries: 0,
  outputDir: "../../.artifacts/ui-test",
  use: {
    baseURL: "http://127.0.0.1:5817",
    headless: true,
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1",
    url: "http://127.0.0.1:5817",
    reuseExistingServer: false,
    env: { WEB_PORT: "5817", VITE_API_BASE_URL: "http://127.0.0.1:5818" },
  },
});
