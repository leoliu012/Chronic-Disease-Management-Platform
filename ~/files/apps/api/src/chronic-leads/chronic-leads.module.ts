import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChronicLeadsController } from './chronic-leads.controller';
import { ChronicLeadsService } from './chronic-leads.service';

@Module({
  imports: [PrismaModule],
  controllers: [ChronicLeadsController],
  providers: [ChronicLeadsService],
  exports: [ChronicLeadsService],
})
export class ChronicLeadsModule {}


