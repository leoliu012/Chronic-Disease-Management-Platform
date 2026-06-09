import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { HospitalMedicationsService } from './hospital-medications.service';
import { CreateHospitalMedicationDto } from './dto/create-hospital-medication.dto';

@Controller('hospital-medications')
export class HospitalMedicationsController {
  constructor(private readonly service: HospitalMedicationsService) {}

  @Post()
  create(@Body() createDto: CreateHospitalMedicationDto) {
    return this.service.create(createDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
