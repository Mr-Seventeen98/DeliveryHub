import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

interface CipherEnvelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(
      config.getOrThrow<string>("CREDENTIAL_ENCRYPTION_KEY"),
      "base64"
    );
    if (this.key.length !== 32) {
      throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes");
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final()
    ]);
    const envelope: CipherEnvelope = {
      v: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64")
    };
    return JSON.stringify(envelope);
  }

  decrypt(ciphertext: string): string {
    const envelope = JSON.parse(ciphertext) as CipherEnvelope;
    if (envelope.v !== 1) {
      throw new Error("Unsupported credential encryption version");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final()
    ]).toString("utf8");
  }
}
