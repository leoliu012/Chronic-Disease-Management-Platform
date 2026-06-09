import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../security/roles.decorator';
import { AdminOpsService } from './admin-ops.service';

@Controller('admin/ops')
@Roles(UserRole.ADMIN)
export class AdminOpsController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get('summary')
  summary() {
    return this.ops.getSummary();
  }

  @Get('reminder-worker')
  reminderWorker() {
    return this.ops.getReminderWorker();
  }

  @Get('gateway')
  gateway() {
    return this.ops.getGateway();
  }

  @Get('data-integrity')
  dataIntegrity() {
    return this.ops.getDataIntegrity();
  }
}
