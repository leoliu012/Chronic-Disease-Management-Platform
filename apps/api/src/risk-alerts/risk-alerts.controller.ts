import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RiskAlertsService } from './risk-alerts.service';
import { CreateRiskAlertDto } from './dto/create-risk-alert.dto';
import { HandleRiskAlertDto } from './dto/handle-risk-alert.dto';
import { QueryRiskAlertsDto } from './dto/query-risk-alerts.dto';

@Controller()
export class RiskAlertsController {
  constructor(private readonly riskAlertsService: RiskAlertsService) {}

  @Post('patients/:patientId/risk-alerts')
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreateRiskAlertDto,
  ) {
    return this.riskAlertsService.create(patientId, dto);
  }

  @Get('risk-alerts')
  findAll(@Query() query: QueryRiskAlertsDto) {
    return this.riskAlertsService.findAll(query);
  }

  @Get('patients/:patientId/risk-alerts')
  findByPatient(
    @Param('patientId') patientId: string,
    @Query() query: QueryRiskAlertsDto,
  ) {
    return this.riskAlertsService.findByPatient(patientId, query);
  }

  @Get('risk-alerts/:id')
  findOne(@Param('id') id: string) {
    return this.riskAlertsService.findOne(id);
  }

  @Patch('risk-alerts/:id/in-progress')
  markInProgress(
    @Param('id') id: string,
    @Body() dto: HandleRiskAlertDto,
  ) {
    return this.riskAlertsService.markInProgress(id, dto);
  }

  @Patch('risk-alerts/:id/resolve')
  resolve(@Param('id') id: string, @Body() dto: HandleRiskAlertDto) {
    return this.riskAlertsService.resolve(id, dto);
  }

  @Patch('risk-alerts/:id/dismiss')
  dismiss(@Param('id') id: string, @Body() dto: HandleRiskAlertDto) {
    return this.riskAlertsService.dismiss(id, dto);
  }
}
