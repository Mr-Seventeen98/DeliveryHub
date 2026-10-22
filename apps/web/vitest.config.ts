/** 单元测试与 Playwright 分开收集，防止新增浏览器套件被 Vitest 当作节点测试执行。 */
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
