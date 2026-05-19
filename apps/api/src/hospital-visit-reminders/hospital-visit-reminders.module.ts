import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { HospitalVisitRemindersController } from './hospital-visit-reminders.controller';
import { HospitalVisitRemindersService } from './hospital-visit-reminders.service';

@Module({
  imports: [PrismaModule, SecurityModule],
  controllers: [HospitalVisitRemindersController],
  providers: [HospitalVisitRemindersService],
  exports: [HospitalVisitRemindersService],
})
export class HospitalVisitRemindersModule {}
