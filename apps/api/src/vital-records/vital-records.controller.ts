import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { VitalRecordsService } from './vital-records.service';
import { CreateVitalRecordDto } from './dto/create-vital-record.dto';
import { QueryVitalRecordsDto } from './dto/query-vital-records.dto';

@Controller()
export class VitalRecordsController {
  constructor(private readonly vitalRecordsService: VitalRecordsService) {}

  @Post('patients/:patientId/vital-records')
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreateVitalRecordDto,
  ) {
    return this.vitalRecordsService.create(patientId, dto);
  }

  @Get('patients/:patientId/vital-records')
  findByPatient(
    @Param('patientId') patientId: string,
    @Query() query: QueryVitalRecordsDto,
  ) {
    return this.vitalRecordsService.findByPatient(patientId, query);
  }

  @Get('vital-records/:id')
  findOne(@Param('id') id: string) {
    return this.vitalRecordsService.findOne(id);
  }

  @Delete('vital-records/:id')
  remove(@Param('id') id: string) {
    return this.vitalRecordsService.remove(id);
  }
}
