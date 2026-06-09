import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ClinicalDispositionService } from './clinical-disposition.service';

@Module({
  imports: [PrismaModule],
  providers: [ClinicalDispositionService],
  exports: [ClinicalDispositionService],
})
export class ClinicalDispositionModule {}
