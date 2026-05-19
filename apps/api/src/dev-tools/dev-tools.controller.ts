import { Controller, Delete, Query } from '@nestjs/common';
import { DevToolsService } from './dev-tools.service';

@Controller('dev-tools')
export class DevToolsController {
  constructor(private readonly devToolsService: DevToolsService) {}

  @Delete('test-data')
  cleanupTestData(@Query('patientId') patientId?: string) {
    return this.devToolsService.cleanupTestData(patientId);
  }
}
