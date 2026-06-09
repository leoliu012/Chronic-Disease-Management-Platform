import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Audit } from '../security/audit.decorator';
import { CreateExamReportDto } from './dto/create-exam-report.dto';
import { ExamReportsService } from './exam-reports.service';

@Controller('exam-reports')
export class ExamReportsController {
  constructor(private readonly service: ExamReportsService) {}

  @Audit({
    action: 'CREATE_EXAM_REPORT',
    target: 'ExamReportRecord',
    targetIdFrom: 'response.id',
    patientIdFrom: 'body.patientId',
  })
  @Post()
  create(@Body() createDto: CreateExamReportDto) {
    return this.service.create(createDto);
  }

  @Audit({
    action: 'VIEW_EXAM_REPORT',
    target: 'ExamReportRecord',
    targetIdFrom: 'params.id',
    patientIdFrom: 'response.patientId',
  })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
