import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import type { RequestUser } from '../security/request-user.type';
import { NurseDashboardService } from './nurse-dashboard.service';

@Controller('nurse-dashboard')
export class NurseDashboardController {
  constructor(private readonly nurseDashboardService: NurseDashboardService) {}

  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @Get()
  getDashboard(@CurrentUser() user: RequestUser) {
    return this.nurseDashboardService.getDashboard(user);
  }
}
