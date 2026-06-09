import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Audit } from '../security/audit.decorator';
import { CreateMedicalRecordSummaryDto } from './dto/create-medical-record-summary.dto';
import { MedicalRecordSummariesService } from './medical-record-summaries.service';

@Controller('medical-record-summaries')
export class MedicalRecordSummariesController {
  constructor(private readonly service: MedicalRecordSummariesService) {}

  @Audit({
    action: 'CREATE_MEDICAL_RECORD',
    target: 'MedicalRecordSummary',
    targetIdFrom: 'response.id',
    patientIdFrom: 'body.patientId',
  })
  @Post()
  create(@Body() createDto: CreateMedicalRecordSummaryDto) {
    return this.service.create(createDto);
  }

  @Audit({
    action: 'VIEW_MEDICAL_RECORD',
    target: 'MedicalRecordSummary',
    targetIdFrom: 'params.id',
    patientIdFrom: 'response.patientId',
  })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
