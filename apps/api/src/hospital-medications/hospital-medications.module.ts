import { Module } from '@nestjs/common';
import { HospitalMedicationsService } from './hospital-medications.service';
import { HospitalMedicationsController } from './hospital-medications.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HospitalMedicationsController],
  providers: [HospitalMedicationsService],
  exports: [HospitalMedicationsService],
})
export class HospitalMedicationsModule {}
