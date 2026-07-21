import { Injectable, NotFoundException } from "@nestjs/common";
import { CredentialType, type RegistryConnection } from "@prisma/client";
import { RegistryClient } from "../../adapters/registry/registry.client";
import { PrismaService } from "../../database/prisma.service";
import { CredentialsService } from "../credentials/credentials.service";
import type {
  CreateRegistryConnectionDto,
  UpdateRegistryConnectionDto
} from "./dto/registry-connection.dto";

@Injectable()
export class RegistriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly client: RegistryClient
  ) {}

  create(dto: CreateRegistryConnectionDto): Promise<RegistryConnection> {
    return this.prisma.registryConnection.create({
      data: {
        ...dto,
        registryUrl: dto.registryUrl.replace(/\/$/, ""),
        verifySsl: dto.verifySsl ?? true
      }
    });
  }

  list(): Promise<RegistryConnection[]> {
    return this.prisma.registryConnection.findMany({
      orderBy: { createdAt: "desc" }
    });
  }

  async get(id: string): Promise<RegistryConnection> {
    const connection = await this.prisma.registryConnection.findUnique({ where: { id } });
    if (!connection) throw new NotFoundException("Registry connection not found");
    return connection;
  }

  async update(
    id: string,
    dto: UpdateRegistryConnectionDto
  ): Promise<RegistryConnection> {
    await this.get(id);
    return this.prisma.registryConnection.update({
      where: { id },
      data: {
        ...dto,
        registryUrl: dto.registryUrl?.replace(/\/$/, "")
      }
    });
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.prisma.registryConnection.delete({ where: { id } });
  }

  async test(id: string): Promise<{ reachable: true }> {
    const connection = await this.get(id);
    const [username, password] = await Promise.all([
      this.credentials.resolve(connection.usernameCredentialId, [
        CredentialType.REGISTRY_USERNAME
      ]),
      this.credentials.resolve(connection.passwordCredentialId, [
        CredentialType.REGISTRY_PASSWORD
      ])
    ]);
    try {
      const result = await this.client.testConnection({
        registryUrl: connection.registryUrl,
        username,
        password,
        verifySsl: connection.verifySsl
      });
      await this.prisma.registryConnection.update({
        where: { id },
        data: { lastTestAt: new Date(), lastTestStatus: "success" }
      });
      return result;
    } catch (error) {
      await this.prisma.registryConnection.update({
        where: { id },
        data: { lastTestAt: new Date(), lastTestStatus: "failed" }
      });
      throw error;
    }
  }

}
