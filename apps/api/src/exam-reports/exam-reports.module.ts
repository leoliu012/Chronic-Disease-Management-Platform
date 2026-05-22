import { Module } from '@nestjs/common';
import { ExamReportsService } from './exam-reports.service';
import { ExamReportsController } from './exam-reports.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ExamReportsController],
  providers: [ExamReportsService],
  exports: [ExamReportsService],
})
export class ExamReportsModule {}
