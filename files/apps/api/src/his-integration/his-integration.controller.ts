import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { HisIntegrationService } from './his-integration.service';
import { ImportHisPatientDto } from './dto/import-his-patient.dto';
import { CurrentUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import type { RequestUser } from '../security/request-user.type';

@Controller('his')
export class HisIntegrationController {
  constructor(private readonly hisIntegrationService: HisIntegrationService) {}

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Get('patients/barcode/:barcode')
  lookupPatientByBarcode(
    @Param('barcode') barcode: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.hisIntegrationService.lookupPatientByBarcode(barcode, user);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('patients/import')
  importPatientDraft(
    @Body() dto: ImportHisPatientDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.hisIntegrationService.importPatientDraft(dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('patients/export')
  exportPatientsForHis(
    @CurrentUser() user: RequestUser,
    @Query('hospitalTenantId') hospitalTenantId?: string,
  ) {
    return this.hisIntegrationService.exportPatientsForHis(user, hospitalTenantId);
  }
}


