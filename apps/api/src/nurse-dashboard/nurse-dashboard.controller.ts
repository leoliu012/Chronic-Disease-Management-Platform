import { Controller, Get, Query } from '@nestjs/common';
import { NurseDashboardService } from './nurse-dashboard.service';
import { QueryNurseDashboardDto } from './dto/query-nurse-dashboard.dto';

@Controller('nurse-dashboard')
export class NurseDashboardController {
  constructor(
    private readonly nurseDashboardService: NurseDashboardService,
  ) {}

  @Get()
  getDashboard(@Query() query: QueryNurseDashboardDto) {
    return this.nurseDashboardService.getDashboard(query.nurseId);
  }
}
