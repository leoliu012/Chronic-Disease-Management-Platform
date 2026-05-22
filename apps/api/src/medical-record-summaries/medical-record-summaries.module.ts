import { Module } from '@nestjs/common';
import { MedicalRecordSummariesService } from './medical-record-summaries.service';
import { MedicalRecordSummariesController } from './medical-record-summaries.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MedicalRecordSummariesController],
  providers: [MedicalRecordSummariesService],
  exports: [MedicalRecordSummariesService],
})
export class MedicalRecordSummariesModule {}
