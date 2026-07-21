import { z } from "zod";

const placeholderPattern =
  /(change[_-]?me|replace[_-]?(with|before)?|placeholder|generate[_-]?with|example)/i;

function hasEnoughDiversity(value: string | Buffer): boolean {
  return typeof value === "string"
    ? new Set(value).size >= 8
    : new Set(value.values()).size >= 8;
}

const environmentSchema = z
  .object({
    APP_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_SECRET_KEY: z.string().min(32),
    CREDENTIAL_ENCRYPTION_KEY: z
      .string()
      .refine(
        (value) => Buffer.from(value, "base64").length === 32,
        "must be a Base64-encoded 32-byte key",
      ),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    API_PORT: z.coerce.number().int().positive().default(3000),
    WEB_BASE_URL: z.string().url().default("http://localhost:5173"),
    PUBLIC_CALLBACK_BASE_URL: z.string().url().default("http://localhost:3000"),
    DEFAULT_BUILD_STATUS_POLL_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(15),
    DEFAULT_SERVER_HEALTH_CHECK_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(15),
    BULLMQ_PREFIX: z.string().default("delivery-hub"),
    LOG_LEVEL: z.string().default("info"),
  })
  .superRefine((environment, context) => {
    if (environment.APP_ENV !== "production") return;

    if (
      placeholderPattern.test(environment.APP_SECRET_KEY) ||
      !hasEnoughDiversity(environment.APP_SECRET_KEY)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["APP_SECRET_KEY"],
        message: "must be a randomly generated production secret",
      });
    }

    const credentialKey = Buffer.from(
      environment.CREDENTIAL_ENCRYPTION_KEY,
      "base64",
    );
    if (!hasEnoughDiversity(credentialKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CREDENTIAL_ENCRYPTION_KEY"],
        message: "must be a randomly generated production key",
      });
    }

    if (placeholderPattern.test(environment.DATABASE_URL)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "must not contain a public placeholder password",
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  config: Record<string, unknown>,
): Environment {
  const result = environmentSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration: ${result.error.message}`,
    );
  }
  return result.data;
}
