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
  findAll(@Query() query: QueryRiskAlertsDto) {
    return this.riskAlertsService.findAll(query);
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
  ) {
    return this.riskAlertsService.markInProgress(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('risk-alerts/:id/resolve')
  resolve(@Param('id') id: string, @Body() dto: HandleRiskAlertDto) {
    return this.riskAlertsService.resolve(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('risk-alerts/:id/dismiss')
  dismiss(@Param('id') id: string, @Body() dto: HandleRiskAlertDto) {
    return this.riskAlertsService.dismiss(id, dto);
  }
}
