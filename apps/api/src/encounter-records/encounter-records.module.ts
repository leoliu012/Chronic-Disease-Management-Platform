import { Module } from '@nestjs/common';
import { EncounterRecordsService } from './encounter-records.service';
import { EncounterRecordsController } from './encounter-records.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EncounterRecordsController],
  providers: [EncounterRecordsService],
  exports: [EncounterRecordsService],
})
export class EncounterRecordsModule {}
