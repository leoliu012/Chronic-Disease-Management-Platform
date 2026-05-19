import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../security/roles.decorator';
import { AuditService } from '../security/audit.service';
import type { RequestUser } from '../security/request-user.type';
import { ClinicalRulesService } from './clinical-rules.service';
import { UpdateVitalThresholdRuleDto } from './dto/update-vital-threshold-rule.dto';
import { UpdateFollowUpPolicyDto } from './dto/update-follow-up-policy.dto';
import { UpdateQuestionnaireTemplateDto } from './dto/update-questionnaire-template.dto';

type RequestWithUser = {
  user?: RequestUser;
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string };
};

function getIpAddress(request: RequestWithUser) {
  const forwardedFor = request.headers['x-forwarded-for'];
  return (Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor || request.socket.remoteAddress)?.toString();
}

@Controller('clinical-rules')
export class ClinicalRulesController {
  constructor(
    private readonly clinicalRulesService: ClinicalRulesService,
    private readonly auditService: AuditService,
  ) {}

  @Get('summary')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  getSummary() {
    return this.clinicalRulesService.getSummary();
  }

  @Post('seed-defaults')
  @Roles(UserRole.ADMIN)
  async seedDefaultRules(@Req() request: RequestWithUser) {
    const result = await this.clinicalRulesService.seedDefaultRules();
    if (request.user) {
      await this.auditService.record({
        user: request.user,
        action: 'SEED_CLINICAL_RULES',
        targetType: 'DiseaseRuleTemplate',
        ipAddress: getIpAddress(request),
        afterData: result,
      });
    }
    return result;
  }

  @Patch('vital-threshold-rules/:id')
  @Roles(UserRole.ADMIN)
  async updateVitalThresholdRule(
    @Param('id') id: string,
    @Body() dto: UpdateVitalThresholdRuleDto,
    @Req() request: RequestWithUser,
  ) {
    const updated = await this.clinicalRulesService.updateVitalThresholdRule(id, dto);
    if (request.user) {
      await this.auditService.record({
        user: request.user,
        action: 'UPDATE_VITAL_THRESHOLD_RULE',
        targetType: 'VitalThresholdRule',
        targetId: id,
        ipAddress: getIpAddress(request),
        afterData: updated,
      });
    }
    return updated;
  }

  @Patch('follow-up-policies/:id')
  @Roles(UserRole.ADMIN)
  async updateFollowUpPolicy(
    @Param('id') id: string,
    @Body() dto: UpdateFollowUpPolicyDto,
    @Req() request: RequestWithUser,
  ) {
    const updated = await this.clinicalRulesService.updateFollowUpPolicy(id, dto);
    if (request.user) {
      await this.auditService.record({
        user: request.user,
        action: 'UPDATE_FOLLOW_UP_POLICY',
        targetType: 'FollowUpPolicy',
        targetId: id,
        ipAddress: getIpAddress(request),
        afterData: updated,
      });
    }
    return updated;
  }

  @Patch('questionnaire-templates/:id')
  @Roles(UserRole.ADMIN)
  async updateQuestionnaireTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateQuestionnaireTemplateDto,
    @Req() request: RequestWithUser,
  ) {
    const updated = await this.clinicalRulesService.updateQuestionnaireTemplate(id, dto);
    if (request.user) {
      await this.auditService.record({
        user: request.user,
        action: 'UPDATE_QUESTIONNAIRE_TEMPLATE',
        targetType: 'QuestionnaireTemplate',
        targetId: id,
        ipAddress: getIpAddress(request),
        afterData: updated,
      });
    }
    return updated;
  }
}
