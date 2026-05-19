import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { MedicationsService } from './medications.service';
import { CreateMedicationDto } from './dto/create-medication.dto';
import { CreateMedicationCheckInDto } from './dto/create-medication-check-in.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';

@Controller()
export class MedicationsController {
  constructor(private readonly medicationsService: MedicationsService) {}

  @Post('patients/:patientId/medications')
  createMedication(
    @Param('patientId') patientId: string,
    @Body() dto: CreateMedicationDto,
  ) {
    return this.medicationsService.createMedication(patientId, dto);
  }

  @Get('patients/:patientId/medications')
  findMedicationsByPatient(@Param('patientId') patientId: string) {
    return this.medicationsService.findMedicationsByPatient(patientId);
  }

  @Get('patients/:patientId/medication-check-ins')
  findCheckInsByPatient(@Param('patientId') patientId: string) {
    return this.medicationsService.findCheckInsByPatient(patientId);
  }


  @Get('patients/:patientId/medication-reminders/due')
  findDueMedicationReminders(@Param('patientId') patientId: string) {
    return this.medicationsService.findDueMedicationReminders(patientId);
  }

  @Get('medications/:id')
  findOne(@Param('id') id: string) {
    return this.medicationsService.findOne(id);
  }

  @Patch('medications/:id')
  updateMedication(
    @Param('id') id: string,
    @Body() dto: UpdateMedicationDto,
  ) {
    return this.medicationsService.updateMedication(id, dto);
  }

  @Delete('medications/:id')
  deleteMedication(@Param('id') id: string) {
    return this.medicationsService.deleteMedication(id);
  }

  @Post('medications/:id/check-ins')
  createCheckIn(
    @Param('id') id: string,
    @Body() dto: CreateMedicationCheckInDto,
  ) {
    return this.medicationsService.createCheckIn(id, dto);
  }
}


