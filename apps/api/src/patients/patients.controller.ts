import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { Roles } from '../security/roles.decorator';
import { EncounterRecordsService } from '../encounter-records/encounter-records.service';
import { MedicalRecordSummariesService } from '../medical-record-summaries/medical-record-summaries.service';
import { ExamReportsService } from '../exam-reports/exam-reports.service';
import { HospitalMedicationsService } from '../hospital-medications/hospital-medications.service';
import { CurrentUser } from '../security/current-user.decorator';
import type { RequestUser } from '../security/request-user.type';
import { Audit } from '../security/audit.decorator';

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
  @Audit({ action: 'CREATE_PATIENT', target: 'Patient', targetIdFrom: 'response.id', patientIdFrom: 'response.id' })
  @Post()
  create(@Body() dto: CreatePatientDto, @CurrentUser() user: RequestUser) {
    return this.patientsService.create(dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Audit({ action: 'VIEW_PATIENT_LIST', target: 'Patient', detailsFrom: { hospitalTenantId: 'query.hospitalTenantId' } })
  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query('hospitalTenantId') hospitalTenantId?: string,
  ) {
    return this.patientsService.findAll(user, hospitalTenantId);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Audit({ action: 'VIEW_PATIENT_DETAIL', target: 'Patient', targetIdFrom: 'params.id', patientIdFrom: 'params.id' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.patientsService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Audit({ action: 'VIEW_ENCOUNTER_RECORDS', target: 'EncounterRecord', patientIdFrom: 'params.id' })
  @Get(':id/encounter-records')
  getEncounterRecords(@Param('id') id: string) {
    return this.encounterRecordsService.findAllByPatient(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Audit({ action: 'VIEW_MEDICAL_RECORDS', target: 'MedicalRecordSummary', patientIdFrom: 'params.id' })
  @Get(':id/medical-record-summaries')
  getMedicalRecordSummaries(@Param('id') id: string) {
    return this.medicalRecordSummariesService.findAllByPatient(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Audit({ action: 'VIEW_EXAM_REPORTS', target: 'ExamReportRecord', patientIdFrom: 'params.id' })
  @Get(':id/exam-reports')
  getExamReports(@Param('id') id: string) {
    return this.examReportsService.findAllByPatient(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Audit({ action: 'VIEW_HOSPITAL_PRESCRIPTIONS', target: 'HospitalMedicationOrder', patientIdFrom: 'params.id' })
  @Get(':id/hospital-medications')
  getHospitalMedications(@Param('id') id: string) {
    return this.hospitalMedicationsService.findAllByPatient(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Audit({ action: 'VIEW_PATIENT_CLINICAL_TIMELINE', target: 'Patient', targetIdFrom: 'params.id', patientIdFrom: 'params.id' })
  @Get(':id/clinical-timeline')
  getClinicalTimeline(
    @Param('id') id: string,
    @Query('taskType') taskType?: string,
  ) {
    return this.patientsService.getClinicalTimeline(id, taskType);
  }
}



