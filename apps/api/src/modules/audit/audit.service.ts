import { Injectable } from "@nestjs/common";
import { AuditResult, Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

export interface AuditEvent {
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  requestId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  result: AuditResult;
  errorMessage?: string;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(event: AuditEvent): Promise<unknown> {
    return this.prisma.auditLog.create({
      data: {
        userId: event.userId,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        requestId: event.requestId,
        beforeJson: event.before,
        afterJson: event.after,
        result: event.result,
        errorMessage: event.errorMessage,
        ipAddress: event.ipAddress
      }
    });
  }
}
