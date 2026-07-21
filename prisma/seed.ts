import { PrismaClient, UserRole } from "@prisma/client";
import { hash } from "argon2";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const username = process.env.INITIAL_ADMIN_USERNAME ?? "admin";
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  const looksLikePublicPlaceholder =
    password &&
    /(change[_-]?me|replace[_-]?(with|before)?|placeholder|generate[_-]?with|example)/i.test(
      password,
    );
  const hasEnoughDiversity = password && new Set(password).size >= 8;
  if (
    !password ||
    password.length < 12 ||
    looksLikePublicPlaceholder ||
    !hasEnoughDiversity
  ) {
    throw new Error(
      "INITIAL_ADMIN_PASSWORD must be at least 12 characters and must be a randomly generated value",
    );
  }
  await prisma.user.upsert({
    where: { username },
    update: {},
    create: {
      username,
      passwordHash: await hash(password),
      displayName: "Administrator",
      role: UserRole.ADMIN,
    },
  });
}

main().finally(async () => prisma.$disconnect());
