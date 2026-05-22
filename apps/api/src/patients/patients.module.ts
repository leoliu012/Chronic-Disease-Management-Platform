import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { EncounterRecordsModule } from '../encounter-records/encounter-records.module';
import { MedicalRecordSummariesModule } from '../medical-record-summaries/medical-record-summaries.module';
import { ExamReportsModule } from '../exam-reports/exam-reports.module';
import { HospitalMedicationsModule } from '../hospital-medications/hospital-medications.module';

@Module({
  imports: [
    EncounterRecordsModule,
    MedicalRecordSummariesModule,
    ExamReportsModule,
    HospitalMedicationsModule,
  ],
  controllers: [PatientsController],
  providers: [PatientsService]
})
export class PatientsModule {}
