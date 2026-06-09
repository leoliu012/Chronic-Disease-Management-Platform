import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Audit } from '../security/audit.decorator';
import { CreateHospitalMedicationDto } from './dto/create-hospital-medication.dto';
import { HospitalMedicationsService } from './hospital-medications.service';

@Controller('hospital-medications')
export class HospitalMedicationsController {
  constructor(private readonly service: HospitalMedicationsService) {}

  @Audit({
    action: 'CREATE_HOSPITAL_PRESCRIPTION',
    target: 'HospitalMedicationOrder',
    targetIdFrom: 'response.id',
    patientIdFrom: 'body.patientId',
  })
  @Post()
  create(@Body() createDto: CreateHospitalMedicationDto) {
    return this.service.create(createDto);
  }

  @Audit({
    action: 'VIEW_HOSPITAL_PRESCRIPTION',
    target: 'HospitalMedicationOrder',
    targetIdFrom: 'params.id',
    patientIdFrom: 'response.patientId',
  })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
