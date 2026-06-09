import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { HospitalVisitRemindersController } from './hospital-visit-reminders.controller';
import { ClinicalDispositionModule } from '../clinical-disposition/clinical-disposition.module';
import { HospitalVisitRemindersService } from './hospital-visit-reminders.service';

@Module({
  imports: [PrismaModule, SecurityModule, ClinicalDispositionModule],
  controllers: [HospitalVisitRemindersController],
  providers: [HospitalVisitRemindersService],
  exports: [HospitalVisitRemindersService],
})
export class HospitalVisitRemindersModule {}
