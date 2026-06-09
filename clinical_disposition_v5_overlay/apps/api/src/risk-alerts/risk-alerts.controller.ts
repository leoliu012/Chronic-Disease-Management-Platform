import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RiskAlertsService } from './risk-alerts.service';
import { CreateRiskAlertDto } from './dto/create-risk-alert.dto';
import { HandleRiskAlertDto } from './dto/handle-risk-alert.dto';
import { QueryRiskAlertsDto } from './dto/query-risk-alerts.dto';
import { Roles } from '../security/roles.decorator';
import { CurrentUser } from '../security/current-user.decorator';
import type { RequestUser } from '../security/request-user.type';

@Controller()
export class RiskAlertsController {
  constructor(private readonly riskAlertsService: RiskAlertsService) {}

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('patients/:patientId/risk-alerts')
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreateRiskAlertDto,
  ) {
    return this.riskAlertsService.create(patientId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('risk-alerts')
  findAll(@Query() query: QueryRiskAlertsDto, @CurrentUser() user: RequestUser) {
    return this.riskAlertsService.findAll(query, user);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('patients/:patientId/risk-alerts')
  findByPatient(
    @Param('patientId') patientId: string,
    @Query() query: QueryRiskAlertsDto,
  ) {
    return this.riskAlertsService.findByPatient(patientId, query);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('risk-alerts/:id')
  findOne(@Param('id') id: string) {
    return this.riskAlertsService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('risk-alerts/:id/in-progress')
  markInProgress(
    @Param('id') id: string,
    @Body() dto: HandleRiskAlertDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.riskAlertsService.markInProgress(id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('risk-alerts/:id/resolve')
  resolve(@Param('id') id: string, @Body() dto: HandleRiskAlertDto, @CurrentUser() user: RequestUser) {
    return this.riskAlertsService.resolve(id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('risk-alerts/:id/dismiss')
  dismiss(@Param('id') id: string, @Body() dto: HandleRiskAlertDto, @CurrentUser() user: RequestUser) {
    return this.riskAlertsService.dismiss(id, dto, user);
  }
}
