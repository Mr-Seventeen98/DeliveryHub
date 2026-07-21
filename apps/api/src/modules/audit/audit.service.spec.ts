import { AuditResult } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../database/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('persists a structured audit event', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit-id' });
    const service = new AuditService({ auditLog: { create } } as unknown as PrismaService);

    await service.record({
      action: 'auth.login',
      resourceType: 'user',
      requestId: 'request-id',
      result: AuditResult.SUCCESS,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'auth.login', requestId: 'request-id' }),
    });
  });
});
