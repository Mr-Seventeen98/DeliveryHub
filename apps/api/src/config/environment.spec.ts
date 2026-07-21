import { describe, expect, it } from "vitest";
import { validateEnvironment } from "./environment";

const validEnvironment = {
  APP_ENV: "test",
  APP_SECRET_KEY: "a".repeat(32),
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  DATABASE_URL: "postgresql://delivery:delivery@localhost:5432/delivery_hub",
  REDIS_URL: "redis://localhost:6379/0",
};
const productionAppSecret = Array.from({ length: 64 }, (_, index) =>
  (index % 16).toString(16),
).join("");

describe("validateEnvironment", () => {
  it("applies safe defaults to a valid environment", () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({
      API_PORT: 3000,
      LOG_LEVEL: "info",
    });
  });

  it("rejects short application secrets", () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, APP_SECRET_KEY: "short" }),
    ).toThrow("Invalid environment configuration");
  });

  it("rejects public placeholder secrets in production", () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        APP_ENV: "production",
        APP_SECRET_KEY: "CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_32",
        CREDENTIAL_ENCRYPTION_KEY: Buffer.from(
          Array.from({ length: 32 }, (_, index) => index),
        ).toString("base64"),
      }),
    ).toThrow("Invalid environment configuration");
  });

  it("rejects low-diversity credential keys in production", () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        APP_ENV: "production",
        APP_SECRET_KEY: productionAppSecret,
        CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
      }),
    ).toThrow("Invalid environment configuration");
  });

  it("accepts independently generated production secrets", () => {
    expect(
      validateEnvironment({
        ...validEnvironment,
        APP_ENV: "production",
        APP_SECRET_KEY: productionAppSecret,
        CREDENTIAL_ENCRYPTION_KEY: Buffer.from(
          Array.from({ length: 32 }, (_, index) => index),
        ).toString("base64"),
      }),
    ).toMatchObject({ APP_ENV: "production" });
  });
});
