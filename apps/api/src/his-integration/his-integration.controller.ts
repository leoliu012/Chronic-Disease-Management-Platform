import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { HisIntegrationService } from './his-integration.service';
import { ImportHisPatientDto } from './dto/import-his-patient.dto';
import { Roles } from '../security/roles.decorator';

@Controller('his')
export class HisIntegrationController {
  constructor(private readonly hisIntegrationService: HisIntegrationService) {}

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Get('patients/barcode/:barcode')
  lookupPatientByBarcode(@Param('barcode') barcode: string) {
    return this.hisIntegrationService.lookupPatientByBarcode(barcode);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('patients/import')
  importPatientDraft(@Body() dto: ImportHisPatientDto) {
    return this.hisIntegrationService.importPatientDraft(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('patients/export')
  exportPatientsForHis() {
    return this.hisIntegrationService.exportPatientsForHis();
  }
}
