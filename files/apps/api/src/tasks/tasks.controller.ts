import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { CreateTaskProcessingEventDto } from './dto/create-task-processing-event.dto';
import { StartTaskProcessingDto } from './dto/start-task-processing.dto';
import { CompleteTaskProcessingDto } from './dto/complete-task-processing.dto';
import { Roles } from '../security/roles.decorator';
import { CurrentUser } from '../security/current-user.decorator';
import type { RequestUser } from '../security/request-user.type';

@Controller()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('patients/:patientId/tasks')
  create(@Param('patientId') patientId: string, @Body() dto: CreateTaskDto, @CurrentUser() user: RequestUser) {
    return this.tasksService.create(patientId, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('tasks')
  findAll(@Query() query: QueryTasksDto, @CurrentUser() user: RequestUser) {
    return this.tasksService.findAll(query, user);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('patients/:patientId/tasks')
  findByPatient(
    @Param('patientId') patientId: string,
    @Query() query: QueryTasksDto,
  ) {
    return this.tasksService.findByPatient(patientId, query);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('tasks/:id')
  findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('tasks/:id/clinical-context')
  getClinicalContext(
    @Param('id') id: string,
    @Query('trendDays') trendDays?: string,
    @Query('historyLimit') historyLimit?: string,
  ) {
    return this.tasksService.getClinicalContext(
      id,
      trendDays ? parseInt(trendDays, 10) : 7,
      historyLimit ? parseInt(historyLimit, 10) : 5,
    );
  }


  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('tasks/:id/processing-events')
  listProcessingEvents(@Param('id') id: string) {
    return this.tasksService.listProcessingEvents(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('tasks/:id/start-processing')
  startProcessing(@Param('id') id: string, @Body() dto: StartTaskProcessingDto) {
    return this.tasksService.startProcessing(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('tasks/:id/processing-events')
  recordProcessingEvent(
    @Param('id') id: string,
    @Body() dto: CreateTaskProcessingEventDto,
  ) {
    return this.tasksService.recordProcessingEvent(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('tasks/:id/complete-processing')
  completeProcessing(@Param('id') id: string, @Body() dto: CompleteTaskProcessingDto) {
    return this.tasksService.completeProcessing(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('tasks/:id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTaskStatusDto) {
    return this.tasksService.updateStatus(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Delete('tasks/:id')
  remove(@Param('id') id: string) {
    return this.tasksService.remove(id);
  }
}




