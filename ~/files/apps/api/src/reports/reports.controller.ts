import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../security/current-user.decorator';
import type { RequestUser } from '../security/request-user.type';
import { ReportsService } from './reports.service';
import { QueryReportDto } from './dto/query-report.dto';
@Controller('reports')
export class ReportsController { constructor(private readonly reportsService: ReportsService) {} @Get('overview') getOverview(@Query() query: QueryReportDto, @CurrentUser() user: RequestUser) { return this.reportsService.getOverview(query, user); } }
