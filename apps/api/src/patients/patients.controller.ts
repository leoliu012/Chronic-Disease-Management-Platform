import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { Roles } from '../security/roles.decorator';
import { EncounterRecordsService } from '../encounter-records/encounter-records.service';
import { MedicalRecordSummariesService } from '../medical-record-summaries/medical-record-summaries.service';
import { ExamReportsService } from '../exam-reports/exam-reports.service';
import { HospitalMedicationsService } from '../hospital-medications/hospital-medications.service';

@Controller('patients')
export class PatientsController {
  constructor(
    private readonly patientsService: PatientsService,
    private readonly encounterRecordsService: EncounterRecordsService,
    private readonly medicalRecordSummariesService: MedicalRecordSummariesService,
    private readonly examReportsService: ExamReportsService,
    private readonly hospitalMedicationsService: HospitalMedicationsService,
  ) {}

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post()
  create(@Body() dto: CreatePatientDto) {
    return this.patientsService.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get()
  findAll() {
    return this.patientsService.findAll();
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.patientsService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get(':id/encounter-records')
  getEncounterRecords(@Param('id') id: string) {
    return this.encounterRecordsService.findAllByPatient(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get(':id/medical-record-summaries')
  getMedicalRecordSummaries(@Param('id') id: string) {
    return this.medicalRecordSummariesService.findAllByPatient(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get(':id/exam-reports')
  getExamReports(@Param('id') id: string) {
    return this.examReportsService.findAllByPatient(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get(':id/hospital-medications')
  getHospitalMedications(@Param('id') id: string) {
    return this.hospitalMedicationsService.findAllByPatient(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get(':id/clinical-timeline')
  getClinicalTimeline(
    @Param('id') id: string,
    @Query('taskType') taskType?: string,
  ) {
    return this.patientsService.getClinicalTimeline(id, taskType);
  }
}
