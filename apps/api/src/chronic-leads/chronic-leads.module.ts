import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FollowUpsModule } from '../follow-ups/follow-ups.module';
import { ChronicLeadsController } from './chronic-leads.controller';
import { ChronicLeadsService } from './chronic-leads.service';

@Module({
  imports: [PrismaModule, FollowUpsModule],
  controllers: [ChronicLeadsController],
  providers: [ChronicLeadsService],
  exports: [ChronicLeadsService],
})
export class ChronicLeadsModule {}
