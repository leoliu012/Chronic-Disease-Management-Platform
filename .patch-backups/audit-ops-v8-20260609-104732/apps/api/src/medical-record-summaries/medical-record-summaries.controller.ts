import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { MedicalRecordSummariesService } from './medical-record-summaries.service';
import { CreateMedicalRecordSummaryDto } from './dto/create-medical-record-summary.dto';

@Controller('medical-record-summaries')
export class MedicalRecordSummariesController {
  constructor(private readonly service: MedicalRecordSummariesService) {}

  @Post()
  create(@Body() createDto: CreateMedicalRecordSummaryDto) {
    return this.service.create(createDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
