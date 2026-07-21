import { describe, expect, it } from "vitest";
import { EncryptionService } from "./encryption.service";

describe("EncryptionService", () => {
  it("round-trips a secret without embedding plaintext", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const service = new EncryptionService({ getOrThrow: () => key } as never);
    const ciphertext = service.encrypt("very-sensitive-token");

    expect(ciphertext).not.toContain("very-sensitive-token");
    expect(service.decrypt(ciphertext)).toBe("very-sensitive-token");
  });

  it("rejects tampered ciphertext", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const service = new EncryptionService({ getOrThrow: () => key } as never);
    const envelope = JSON.parse(service.encrypt("secret")) as { data: string };
    envelope.data = Buffer.from("tampered").toString("base64");
    expect(() => service.decrypt(JSON.stringify(envelope))).toThrow();
  });
});
