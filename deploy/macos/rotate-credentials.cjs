#!/usr/bin/env node
/**
 * 在恢复后的迁移副本中轮换凭据加密密钥，明文只在内存中短暂存在。
 * 调用前必须停止 API/Worker、保留原库与密钥，并在当前 release 生成 Prisma 客户端。
 * 该工具仅接受本方案的回环 PostgreSQL 15432，避免误写仍在运行的源数据库。
 */
const { readFileSync, statSync } = require("node:fs");
const { PrismaClient } = require("../../node_modules/@prisma/client");
const {
  EncryptionService,
} = require("../../apps/api/dist/modules/credentials/encryption.service.js");

async function main() {
  const database = new URL(process.env.DATABASE_URL);
  if (database.hostname !== "127.0.0.1" || database.port !== "15432") {
    throw new Error("Expected isolated target database on 127.0.0.1:15432");
  }
  const keyFile = process.argv[2];
  if (!keyFile || (statSync(keyFile).mode & 0o077) !== 0) {
    throw new Error("Old key file must be readable only by its owner");
  }
  const oldKey = readFileSync(keyFile, "utf8").trim();
  const newKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (
    !newKey ||
    oldKey === newKey ||
    Buffer.from(newKey, "base64").length !== 32
  ) {
    throw new Error("A different 32-byte target key is required");
  }
  const cryptoFor = (key) => new EncryptionService({ getOrThrow: () => key });
  const oldCrypto = cryptoFor(oldKey);
  const newCrypto = cryptoFor(newKey);
  const prisma = new PrismaClient();
  try {
    // 全部凭据在一个事务中更新；任意一条无法验证会回滚，不产生部分轮换。
    const summary = await prisma.$transaction(
      async (tx) => {
        const rows = await tx.credential.findMany({
          select: { id: true, ciphertext: true },
        });
        let rotated = 0;
        let alreadyRotated = 0;
        for (const row of rows) {
          let plaintext;
          try {
            plaintext = oldCrypto.decrypt(row.ciphertext);
          } catch {
            // 只允许用同一目标密钥恢复中断后的重试；损坏或其他密钥的记录仍会使整个事务失败。
            newCrypto.decrypt(row.ciphertext);
            alreadyRotated += 1;
            continue;
          }
          const ciphertext = newCrypto.encrypt(plaintext);
          if (newCrypto.decrypt(ciphertext) !== plaintext) {
            throw new Error("Credential plaintext equivalence check failed");
          }
          // 保留 ID、提示、业务时间等元数据，只改变密文；CAS 条件防止并发写入被悄悄覆盖。
          const count = await tx.$executeRaw`
          UPDATE credentials SET ciphertext = ${ciphertext}
          WHERE id = ${row.id}::uuid AND ciphertext = ${row.ciphertext}
        `;
          if (count !== 1)
            throw new Error("Credential changed during rotation");
          rotated += 1;
        }
        return {
          credentials: rows.length,
          rotated,
          alreadyRotated,
          plaintextEquivalent: true,
        };
      },
      { timeout: 30000 },
    );
    console.log(JSON.stringify(summary));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  // 解密、连接和 SQL 异常可能携带敏感上下文，失败只输出操作边界，不回显异常内容。
  console.error(
    "Credential rotation failed; keep application services stopped and verify the protected checkpoint before retrying.",
  );
  process.exitCode = 1;
});
