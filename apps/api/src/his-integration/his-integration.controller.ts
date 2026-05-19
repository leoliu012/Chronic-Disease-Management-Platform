import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { HisIntegrationService } from './his-integration.service';
import { ImportHisPatientDto } from './dto/import-his-patient.dto';

@Controller('his')
export class HisIntegrationController {
  constructor(private readonly hisIntegrationService: HisIntegrationService) {}

  @Get('patients/barcode/:barcode')
  lookupPatientByBarcode(@Param('barcode') barcode: string) {
    return this.hisIntegrationService.lookupPatientByBarcode(barcode);
  }

  @Post('patients/import')
  importPatientDraft(@Body() dto: ImportHisPatientDto) {
    return this.hisIntegrationService.importPatientDraft(dto);
  }

  @Get('patients/export')
  exportPatientsForHis() {
    return this.hisIntegrationService.exportPatientsForHis();
  }
}
