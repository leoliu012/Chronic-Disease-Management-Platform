import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { ClinicalDispositionModule } from '../clinical-disposition/clinical-disposition.module';
import { TasksService } from './tasks.service';

@Module({
  imports: [ClinicalDispositionModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
