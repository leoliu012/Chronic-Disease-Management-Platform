import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Audit } from '../security/audit.decorator';
import { CreateEncounterRecordDto } from './dto/create-encounter-record.dto';
import { EncounterRecordsService } from './encounter-records.service';

@Controller('encounter-records')
export class EncounterRecordsController {
  constructor(private readonly encounterRecordsService: EncounterRecordsService) {}

  @Audit({
    action: 'CREATE_ENCOUNTER_RECORD',
    target: 'EncounterRecord',
    targetIdFrom: 'response.id',
    patientIdFrom: 'body.patientId',
  })
  @Post()
  create(@Body() createEncounterRecordDto: CreateEncounterRecordDto) {
    return this.encounterRecordsService.create(createEncounterRecordDto);
  }

  @Audit({
    action: 'VIEW_ENCOUNTER_RECORD',
    target: 'EncounterRecord',
    targetIdFrom: 'params.id',
    patientIdFrom: 'response.patientId',
  })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.encounterRecordsService.findOne(id);
  }
}
