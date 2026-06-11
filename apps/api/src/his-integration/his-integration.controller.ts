import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { HisIntegrationService } from './his-integration.service';
import { ImportHisPatientDto } from './dto/import-his-patient.dto';
import { CurrentUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import type { RequestUser } from '../security/request-user.type';
import { Audit } from '../security/audit.decorator';

@Controller('his')
export class HisIntegrationController {
  constructor(private readonly hisIntegrationService: HisIntegrationService) {}

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ action: 'LOOKUP_HIS_PATIENT_BY_BARCODE', target: 'Patient', detailsFrom: { barcode: 'params.barcode' } })
  @Get('patients/barcode/:barcode')
  lookupPatientByBarcode(
    @Param('barcode') barcode: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.hisIntegrationService.lookupPatientByBarcode(barcode, user);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ mode: 'REQUIRED', action: 'IMPORT_HIS_PATIENT_DRAFT', target: 'Patient', targetIdFrom: 'response.id', patientIdFrom: 'response.id' })
  @Post('patients/import')
  importPatientDraft(
    @Body() dto: ImportHisPatientDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.hisIntegrationService.importPatientDraft(dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Audit({ mode: 'REQUIRED', action: 'EXPORT_PATIENT_DATA', target: 'Patient', detailsFrom: { hospitalTenantId: 'query.hospitalTenantId' } })
  @Get('patients/export')
  exportPatientsForHis(
    @CurrentUser() user: RequestUser,
    @Query('hospitalTenantId') hospitalTenantId?: string,
  ) {
    return this.hisIntegrationService.exportPatientsForHis(user, hospitalTenantId);
  }
}



