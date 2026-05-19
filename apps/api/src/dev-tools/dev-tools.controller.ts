import { Controller, Delete, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DevToolsService } from './dev-tools.service';
import { Roles } from '../security/roles.decorator';

@Controller('dev-tools')
@Roles(UserRole.ADMIN)
export class DevToolsController {
  constructor(private readonly devToolsService: DevToolsService) {}

  @Delete('test-data')
  cleanupTestData(@Query('patientId') patientId?: string) {
    return this.devToolsService.cleanupTestData(patientId);
  }
}
