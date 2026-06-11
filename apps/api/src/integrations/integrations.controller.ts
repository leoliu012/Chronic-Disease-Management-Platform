import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuditService } from '../security/audit.service';
import type { RequestUser } from '../security/request-user.type';
import { Roles } from '../security/roles.decorator';
import { UpdateFieldMappingDto } from './dto/update-field-mapping.dto';
import { IntegrationsService } from './integrations.service';
import { resolveClientIp } from '../security/client-ip.util';

type RequestWithUser = {
  user?: RequestUser;
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string };
};

function getIpAddress(request: RequestWithUser) {
  return resolveClientIp(request).clientIp ?? undefined;
}

// Integration sources are explicitly tenant-bound. The current integration
// center remains ADMIN-only; future platform-admin views can add cross-tenant
// aggregation as a separate, audited endpoint.
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('dashboard')
  @Roles(UserRole.ADMIN)
  getDashboard() {
    return this.integrationsService.getDashboard();
  }

  @Get('sources')
  @Roles(UserRole.ADMIN)
  getSources() {
    return this.integrationsService.getSources();
  }

  @Get('sync-batches')
  @Roles(UserRole.ADMIN)
  getBatches() {
    return this.integrationsService.getBatches();
  }

  @Get('sync-records')
  @Roles(UserRole.ADMIN)
  getRecords(@Query('batchId') batchId?: string) {
    return this.integrationsService.getRecords(batchId);
  }

  @Get('field-mappings')
  @Roles(UserRole.ADMIN)
  getFieldMappings() {
    return this.integrationsService.getFieldMappings();
  }

  @Post('seed-defaults')
  @Roles(UserRole.ADMIN)
  async seedDefaults(@Req() request: RequestWithUser) {
    const result = await this.integrationsService.seedDefaults();
    if (request.user) {
      await this.auditService.record({
        user: request.user,
        action: 'SEED_INTEGRATION_DEFAULTS',
        targetType: 'IntegrationSource',
        ipAddress: getIpAddress(request),
        afterData: result,
      });
    }
    return result;
  }

  @Patch('field-mappings/:id')
  @Roles(UserRole.ADMIN)
  async updateFieldMapping(
    @Param('id') id: string,
    @Body() dto: UpdateFieldMappingDto,
    @Req() request: RequestWithUser,
  ) {
    const updated = await this.integrationsService.updateFieldMapping(id, dto);
    if (request.user) {
      await this.auditService.record({
        user: request.user,
        action: 'UPDATE_INTEGRATION_FIELD_MAPPING',
        targetType: 'IntegrationFieldMapping',
        targetId: id,
        ipAddress: getIpAddress(request),
        afterData: updated,
      });
    }
    return updated;
  }

  @Post('mock-sync/his-patients')
  @Roles(UserRole.ADMIN)
  async mockSyncHisPatients(@Req() request: RequestWithUser) {
    const result = await this.integrationsService.mockSyncHisPatients(request.user?.id);
    await this.auditSync(request, 'MOCK_SYNC_HIS_PATIENTS', result.id, result);
    return result;
  }

  @Post('mock-sync/emr-diagnoses')
  @Roles(UserRole.ADMIN)
  async mockSyncEmrDiagnoses(@Req() request: RequestWithUser) {
    const result = await this.integrationsService.mockSyncEmrDiagnoses(request.user?.id);
    await this.auditSync(request, 'MOCK_SYNC_EMR_DIAGNOSES', result.id, result);
    return result;
  }

  @Post('mock-sync/lis-results')
  @Roles(UserRole.ADMIN)
  async mockSyncLisResults(@Req() request: RequestWithUser) {
    const result = await this.integrationsService.mockSyncLisResults(request.user?.id);
    await this.auditSync(request, 'MOCK_SYNC_LIS_RESULTS', result.id, result);
    return result;
  }

  @Post('mock-sync/prescriptions')
  @Roles(UserRole.ADMIN)
  async mockSyncPrescriptions(@Req() request: RequestWithUser) {
    const result = await this.integrationsService.mockSyncPrescriptions(request.user?.id);
    await this.auditSync(request, 'MOCK_SYNC_PRESCRIPTIONS', result.id, result);
    return result;
  }

  private async auditSync(request: RequestWithUser, action: string, targetId: string, result: unknown) {
    if (!request.user) return;
    await this.auditService.record({
      user: request.user,
      action,
      targetType: 'IntegrationSyncBatch',
      targetId,
      ipAddress: getIpAddress(request),
      afterData: result,
    });
  }
}


