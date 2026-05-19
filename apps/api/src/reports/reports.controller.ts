import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { QueryReportDto } from './dto/query-report.dto';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('overview')
  getOverview(@Query() query: QueryReportDto) {
    return this.reportsService.getOverview(query);
  }
}
