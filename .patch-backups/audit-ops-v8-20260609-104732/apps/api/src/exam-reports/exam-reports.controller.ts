import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ExamReportsService } from './exam-reports.service';
import { CreateExamReportDto } from './dto/create-exam-report.dto';

@Controller('exam-reports')
export class ExamReportsController {
  constructor(private readonly service: ExamReportsService) {}

  @Post()
  create(@Body() createDto: CreateExamReportDto) {
    return this.service.create(createDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
