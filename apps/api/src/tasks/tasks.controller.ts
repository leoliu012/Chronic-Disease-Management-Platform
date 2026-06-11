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
import { Audit } from '../security/audit.decorator';

@Controller()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ mode: 'REQUIRED', action: 'CREATE_TASK', target: 'Task', targetIdFrom: 'response.id', patientIdFrom: 'params.patientId' })
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
  @Audit({ action: 'VIEW_TASK', target: 'Task', targetIdFrom: 'params.id', patientIdFrom: 'response.patientId' })
  @Get('tasks/:id')
  findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Audit({ action: 'VIEW_TASK_CLINICAL_CONTEXT', target: 'Task', targetIdFrom: 'params.id' })
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
  @Audit({ action: 'VIEW_TASK_PROCESSING_EVENTS', target: 'Task', targetIdFrom: 'params.id' })
  @Get('tasks/:id/processing-events')
  listProcessingEvents(@Param('id') id: string) {
    return this.tasksService.listProcessingEvents(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ mode: 'REQUIRED', action: 'START_TASK_PROCESSING', target: 'Task', targetIdFrom: 'params.id', patientIdFrom: 'response.patientId' })
  @Patch('tasks/:id/start-processing')
  startProcessing(@Param('id') id: string, @Body() dto: StartTaskProcessingDto, @CurrentUser() user: RequestUser) {
    return this.tasksService.startProcessing(id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ mode: 'REQUIRED', action: 'APPEND_TASK_PROCESSING_EVENT', target: 'Task', targetIdFrom: 'params.id' })
  @Post('tasks/:id/processing-events')
  recordProcessingEvent(
    @Param('id') id: string,
    @Body() dto: CreateTaskProcessingEventDto,
  ) {
    return this.tasksService.recordProcessingEvent(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ mode: 'REQUIRED', action: 'COMPLETE_TASK_PROCESSING', target: 'Task', targetIdFrom: 'params.id', patientIdFrom: 'response.patientId' })
  @Patch('tasks/:id/complete-processing')
  completeProcessing(@Param('id') id: string, @Body() dto: CompleteTaskProcessingDto, @CurrentUser() user: RequestUser) {
    return this.tasksService.completeProcessing(id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ mode: 'REQUIRED', action: 'UPDATE_TASK_STATUS', target: 'Task', targetIdFrom: 'params.id', patientIdFrom: 'response.patientId' })
  @Patch('tasks/:id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTaskStatusDto, @CurrentUser() user: RequestUser) {
    return this.tasksService.updateStatus(id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ mode: 'REQUIRED', action: 'CANCEL_TASK', target: 'Task', targetIdFrom: 'params.id', patientIdFrom: 'response.patientId' })
  @Delete('tasks/:id')
  remove(@Param('id') id: string) {
    return this.tasksService.remove(id);
  }
}

