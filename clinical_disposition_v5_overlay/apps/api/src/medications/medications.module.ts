import { Module } from '@nestjs/common';
import { MedicationsController } from './medications.controller';
import { ClinicalDispositionModule } from '../clinical-disposition/clinical-disposition.module';
import { MedicationsService } from './medications.service';

@Module({
  imports: [ClinicalDispositionModule],
  controllers: [MedicationsController],
  providers: [MedicationsService],
})
export class MedicationsModule {}
