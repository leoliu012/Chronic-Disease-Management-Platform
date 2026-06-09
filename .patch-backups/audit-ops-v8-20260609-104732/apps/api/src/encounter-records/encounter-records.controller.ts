import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { EncounterRecordsService } from './encounter-records.service';
import { CreateEncounterRecordDto } from './dto/create-encounter-record.dto';

@Controller('encounter-records')
export class EncounterRecordsController {
  constructor(private readonly encounterRecordsService: EncounterRecordsService) {}

  @Post()
  create(@Body() createEncounterRecordDto: CreateEncounterRecordDto) {
    return this.encounterRecordsService.create(createEncounterRecordDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.encounterRecordsService.findOne(id);
  }
}
