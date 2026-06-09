import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Audit } from '../security/audit.decorator';
import { CreateMedicationCheckInDto } from './dto/create-medication-check-in.dto';
import { CreateMedicationDto } from './dto/create-medication.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';
import { MedicationsService } from './medications.service';

@Controller()
export class MedicationsController {
  constructor(private readonly medicationsService: MedicationsService) {}

  @Audit({
    action: 'CREATE_MEDICATION_PLAN',
    target: 'MedicationRecord',
    targetIdFrom: 'response.id',
    patientIdFrom: 'params.patientId',
  })
  @Post('patients/:patientId/medications')
  createMedication(
    @Param('patientId') patientId: string,
    @Body() dto: CreateMedicationDto,
  ) {
    return this.medicationsService.createMedication(patientId, dto);
  }

  @Audit({
    action: 'VIEW_MEDICATION_PLANS',
    target: 'MedicationRecord',
    patientIdFrom: 'params.patientId',
  })
  @Get('patients/:patientId/medications')
  findMedicationsByPatient(@Param('patientId') patientId: string) {
    return this.medicationsService.findMedicationsByPatient(patientId);
  }

  @Audit({
    action: 'VIEW_MEDICATION_CHECKINS',
    target: 'MedicationCheckIn',
    patientIdFrom: 'params.patientId',
  })
  @Get('patients/:patientId/medication-check-ins')
  findCheckInsByPatient(@Param('patientId') patientId: string) {
    return this.medicationsService.findCheckInsByPatient(patientId);
  }

  @Get('patients/:patientId/medication-reminders/due')
  findDueMedicationReminders(@Param('patientId') patientId: string) {
    return this.medicationsService.findDueMedicationReminders(patientId);
  }

  @Audit({
    action: 'VIEW_MEDICATION_PLAN',
    target: 'MedicationRecord',
    targetIdFrom: 'params.id',
    patientIdFrom: 'response.patientId',
  })
  @Get('medications/:id')
  findOne(@Param('id') id: string) {
    return this.medicationsService.findOne(id);
  }

  @Audit({
    action: 'UPDATE_MEDICATION_PLAN',
    target: 'MedicationRecord',
    targetIdFrom: 'params.id',
    patientIdFrom: 'response.patientId',
  })
  @Patch('medications/:id')
  updateMedication(
    @Param('id') id: string,
    @Body() dto: UpdateMedicationDto,
  ) {
    return this.medicationsService.updateMedication(id, dto);
  }

  @Audit({
    action: 'DEACTIVATE_MEDICATION_PLAN',
    target: 'MedicationRecord',
    targetIdFrom: 'params.id',
    patientIdFrom: 'response.patientId',
  })
  @Delete('medications/:id')
  deleteMedication(@Param('id') id: string) {
    return this.medicationsService.deleteMedication(id);
  }

  @Audit({
    action: 'CREATE_MEDICATION_CHECKIN',
    target: 'MedicationCheckIn',
    targetIdFrom: 'response.id',
    patientIdFrom: 'response.patientId',
  })
  @Post('medications/:id/check-ins')
  createCheckIn(
    @Param('id') id: string,
    @Body() dto: CreateMedicationCheckInDto,
  ) {
    return this.medicationsService.createCheckIn(id, dto);
  }
}
