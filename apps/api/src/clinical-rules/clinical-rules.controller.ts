import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../security/roles.decorator';
import { Audit } from '../security/audit.decorator';
import { ClinicalRulesService } from './clinical-rules.service';
import { UpdateVitalThresholdRuleDto } from './dto/update-vital-threshold-rule.dto';
import { UpdateFollowUpPolicyDto } from './dto/update-follow-up-policy.dto';
import { UpdateQuestionnaireTemplateDto } from './dto/update-questionnaire-template.dto';


@Controller('clinical-rules')
export class ClinicalRulesController {
  constructor(private readonly clinicalRulesService: ClinicalRulesService) {}

  @Get('summary')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  getSummary() {
    return this.clinicalRulesService.getSummary();
  }

  @Audit({ action: 'SEED_CLINICAL_RULES', target: 'DiseaseRuleTemplate' })
  @Post('seed-defaults')
  @Roles(UserRole.ADMIN)
  seedDefaultRules() {
    return this.clinicalRulesService.seedDefaultRules();
  }

  @Audit({ action: 'UPDATE_VITAL_THRESHOLD_RULE', target: 'VitalThresholdRule', targetIdFrom: 'params.id' })
  @Patch('vital-threshold-rules/:id')
  @Roles(UserRole.ADMIN)
  updateVitalThresholdRule(
    @Param('id') id: string,
    @Body() dto: UpdateVitalThresholdRuleDto,
  ) {
    return this.clinicalRulesService.updateVitalThresholdRule(id, dto);
  }

  @Audit({ action: 'UPDATE_FOLLOW_UP_POLICY', target: 'FollowUpPolicy', targetIdFrom: 'params.id' })
  @Patch('follow-up-policies/:id')
  @Roles(UserRole.ADMIN)
  updateFollowUpPolicy(
    @Param('id') id: string,
    @Body() dto: UpdateFollowUpPolicyDto,
  ) {
    return this.clinicalRulesService.updateFollowUpPolicy(id, dto);
  }

  @Audit({ action: 'UPDATE_QUESTIONNAIRE_TEMPLATE', target: 'QuestionnaireTemplate', targetIdFrom: 'params.id' })
  @Patch('questionnaire-templates/:id')
  @Roles(UserRole.ADMIN)
  updateQuestionnaireTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateQuestionnaireTemplateDto,
  ) {
    return this.clinicalRulesService.updateQuestionnaireTemplate(id, dto);
  }
}

