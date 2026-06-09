import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Public } from '../security/public.decorator';
import { Roles } from '../security/roles.decorator';
import { CurrentUser } from '../security/current-user.decorator';
import type { RequestUser } from '../security/request-user.type';
import { CreateVitalRecordDto } from '../vital-records/dto/create-vital-record.dto';
import { CreateMedicationCheckInDto } from '../medications/dto/create-medication-check-in.dto';
import { CreateQuestionnaireResultDto } from '../questionnaires/dto/create-questionnaire-result.dto';
import { MarkVitalMonitoringMissedDto } from '../vital-monitoring-plans/dto/mark-vital-monitoring-missed.dto';
import { CreatePatientBindingRequestDto } from './dto/create-patient-binding-request.dto';
import { PatientDemoLoginDto } from './dto/patient-demo-login.dto';
import { RejectPatientBindingDto } from './dto/reject-patient-binding.dto';
import { CurrentPatientSession } from './current-patient-session.decorator';
import { PatientAppService } from './patient-app.service';
import { PatientSessionGuard } from './patient-session.guard';
import type { PatientSessionRequest, PatientSessionRequestContext } from './patient-session.type';

type IpRequest = {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
};

function getIpAddress(req: IpRequest) {
  const forwardedFor = req.headers['x-forwarded-for'];
  return (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.socket?.remoteAddress)?.toString();
}

@Public()
@Controller('patient-app')
export class PatientAppController {
  constructor(private readonly patientAppService: PatientAppService) {}

  @Post('demo-login')
  demoLogin(@Body() dto: PatientDemoLoginDto, @Req() req: IpRequest) {
    return this.patientAppService.loginWithDemoOpenId(dto, getIpAddress(req));
  }

  @Post('binding-requests')
  createBindingRequest(@Body() dto: CreatePatientBindingRequestDto, @Req() req: IpRequest) {
    return this.patientAppService.createBindingRequest(dto, getIpAddress(req));
  }

  @UseGuards(PatientSessionGuard)
  @Get('me')
  me(@CurrentPatientSession() session: PatientSessionRequestContext) {
    return this.patientAppService.getMe(session);
  }

  @UseGuards(PatientSessionGuard)
  @Get('vitals')
  getVitals(@CurrentPatientSession() session: PatientSessionRequestContext) {
    return this.patientAppService.getVitals(session);
  }

  @UseGuards(PatientSessionGuard)
  @Post('vitals')
  createVital(
    @CurrentPatientSession() session: PatientSessionRequestContext,
    @Body() dto: CreateVitalRecordDto,
    @Req() req: PatientSessionRequest,
  ) {
    return this.patientAppService.createVital(session, dto, getIpAddress(req));
  }

  @UseGuards(PatientSessionGuard)
  @Get('risk-alerts')
  getRiskAlerts(@CurrentPatientSession() session: PatientSessionRequestContext) {
    return this.patientAppService.getRiskAlerts(session);
  }

  @UseGuards(PatientSessionGuard)
  @Get('hospital-visit-reminders')
  getHospitalVisitReminders(@CurrentPatientSession() session: PatientSessionRequestContext) {
    return this.patientAppService.getHospitalVisitReminders(session);
  }


  @UseGuards(PatientSessionGuard)
  @Get('tasks')
  getTasks(@CurrentPatientSession() session: PatientSessionRequestContext) {
    return this.patientAppService.getTasks(session);
  }

  @UseGuards(PatientSessionGuard)
  @Get('medications')
  getMedications(@CurrentPatientSession() session: PatientSessionRequestContext) {
    return this.patientAppService.getMedications(session);
  }

  @UseGuards(PatientSessionGuard)
  @Get('medication-check-ins')
  getMedicationCheckIns(@CurrentPatientSession() session: PatientSessionRequestContext) {
    return this.patientAppService.getMedicationCheckIns(session);
  }

  @UseGuards(PatientSessionGuard)
  @Post('medications/:id/check-ins')
  createMedicationCheckIn(
    @CurrentPatientSession() session: PatientSessionRequestContext,
    @Param('id') id: string,
    @Body() dto: CreateMedicationCheckInDto,
    @Req() req: PatientSessionRequest,
  ) {
    return this.patientAppService.createMedicationCheckIn(session, id, dto, getIpAddress(req));
  }

  @UseGuards(PatientSessionGuard)
  @Get('questionnaire-results')
  getQuestionnaireResults(@CurrentPatientSession() session: PatientSessionRequestContext) {
    return this.patientAppService.getQuestionnaireResults(session);
  }

  @UseGuards(PatientSessionGuard)
  @Post('questionnaire-results')
  createQuestionnaireResult(
    @CurrentPatientSession() session: PatientSessionRequestContext,
    @Body() dto: CreateQuestionnaireResultDto,
    @Req() req: PatientSessionRequest,
  ) {
    return this.patientAppService.createQuestionnaireResult(session, dto, getIpAddress(req));
  }

  @UseGuards(PatientSessionGuard)
  @Get('vital-monitoring-plans')
  getVitalMonitoringPlans(@CurrentPatientSession() session: PatientSessionRequestContext) {
    return this.patientAppService.getVitalMonitoringPlans(session);
  }

  @UseGuards(PatientSessionGuard)
  @Post('vital-monitoring-plans/:id/miss')
  markVitalMonitoringMissed(
    @CurrentPatientSession() session: PatientSessionRequestContext,
    @Param('id') id: string,
    @Body() dto: MarkVitalMonitoringMissedDto,
    @Req() req: PatientSessionRequest,
  ) {
    return this.patientAppService.markVitalMonitoringMissed(session, id, dto, getIpAddress(req));
  }
}

@Controller('patient-binding-requests')
export class PatientBindingReviewController {
  constructor(private readonly patientAppService: PatientAppService) {}

  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @Get()
  findBindingRequests(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('hospitalTenantId') hospitalTenantId?: string,
  ) {
    return this.patientAppService.findBindingRequests(user, status, hospitalTenantId);
  }

  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @Patch(':id/approve')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: IpRequest,
  ) {
    return this.patientAppService.approveBindingRequest(id, user, getIpAddress(req));
  }

  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @Patch(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectPatientBindingDto,
    @CurrentUser() user: RequestUser,
    @Req() req: IpRequest,
  ) {
    return this.patientAppService.rejectBindingRequest(id, dto, user, getIpAddress(req));
  }
}




