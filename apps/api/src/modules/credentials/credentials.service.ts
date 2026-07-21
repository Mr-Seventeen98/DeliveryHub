import { Injectable, NotFoundException } from "@nestjs/common";
import type { Credential, CredentialType } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import type { CreateCredentialDto } from "./dto/create-credential.dto";
import { EncryptionService } from "./encryption.service";

export type CredentialView = Pick<
  Credential,
  | "id"
  | "name"
  | "type"
  | "maskedHint"
  | "enabled"
  | "lastUsedAt"
  | "expiresAt"
  | "createdAt"
  | "updatedAt"
>;

const selectView = {
  id: true,
  name: true,
  type: true,
  maskedHint: true,
  enabled: true,
  lastUsedAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true
} as const;

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService
  ) {}

  create(dto: CreateCredentialDto, userId: string): Promise<CredentialView> {
    return this.prisma.credential.create({
      data: {
        name: dto.name,
        type: dto.type,
        ciphertext: this.encryption.encrypt(dto.secret),
        maskedHint: this.mask(dto.secret),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        createdById: userId
      },
      select: selectView
    });
  }

  list(): Promise<CredentialView[]> {
    return this.prisma.credential.findMany({
      select: selectView,
      orderBy: { createdAt: "desc" }
    });
  }

  async resolve(id: string, expectedTypes?: CredentialType[]): Promise<string> {
    const credential = await this.prisma.credential.findUnique({ where: { id } });
    if (
      !credential?.enabled ||
      (expectedTypes && !expectedTypes.includes(credential.type))
    ) {
      throw new NotFoundException("Credential not found");
    }
    if (credential.expiresAt && credential.expiresAt <= new Date()) {
      throw new NotFoundException("Credential expired");
    }
    await this.prisma.credential.update({
      where: { id },
      data: { lastUsedAt: new Date() }
    });
    return this.encryption.decrypt(credential.ciphertext);
  }

  async disable(id: string): Promise<void> {
    const result = await this.prisma.credential.updateMany({
      where: { id },
      data: { enabled: false }
    });
    if (result.count === 0) {
      throw new NotFoundException("Credential not found");
    }
  }

  private mask(secret: string): string {
    return secret.length <= 4
      ? "****"
      : `${"*".repeat(Math.min(8, secret.length - 4))}${secret.slice(-4)}`;
  }
}
