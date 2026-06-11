import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Audit } from '../security/audit.decorator';
import { CurrentUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import type { RequestUser } from '../security/request-user.type';
import { ClinicalRulesService } from './clinical-rules.service';
import { CreateRuleVersionDto } from './dto/create-rule-version.dto';
import { ReviewRuleVersionDto } from './dto/review-rule-version.dto';
import { SimulateRuleDto } from './dto/simulate-rule.dto';
import { UpdateFollowUpPolicyDto } from './dto/update-follow-up-policy.dto';
import { UpdateQuestionnaireTemplateDto } from './dto/update-questionnaire-template.dto';
import { UpdateVitalThresholdRuleDto } from './dto/update-vital-threshold-rule.dto';

@Controller('clinical-rules')
export class ClinicalRulesController {
  constructor(private readonly clinicalRulesService: ClinicalRulesService) {}

  @Get('summary')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  getSummary() { return this.clinicalRulesService.getSummary(); }

  @Audit({ action: 'SEED_CLINICAL_RULES', target: 'DiseaseRuleTemplate' })
  @Post('seed-defaults')
  @Roles(UserRole.ADMIN)
  seedDefaultRules() { return this.clinicalRulesService.seedDefaultRules(); }

  @Audit({ action: 'UPDATE_VITAL_THRESHOLD_RULE', target: 'VitalThresholdRule', targetIdFrom: 'params.id' })
  @Patch('vital-threshold-rules/:id')
  @Roles(UserRole.ADMIN)
  updateVitalThresholdRule(@Param('id') id: string, @Body() dto: UpdateVitalThresholdRuleDto) { return this.clinicalRulesService.updateVitalThresholdRule(id, dto); }

  @Audit({ action: 'UPDATE_FOLLOW_UP_POLICY', target: 'FollowUpPolicy', targetIdFrom: 'params.id' })
  @Patch('follow-up-policies/:id')
  @Roles(UserRole.ADMIN)
  updateFollowUpPolicy(@Param('id') id: string, @Body() dto: UpdateFollowUpPolicyDto) { return this.clinicalRulesService.updateFollowUpPolicy(id, dto); }

  @Audit({ action: 'UPDATE_QUESTIONNAIRE_TEMPLATE', target: 'QuestionnaireTemplate', targetIdFrom: 'params.id' })
  @Patch('questionnaire-templates/:id')
  @Roles(UserRole.ADMIN)
  updateQuestionnaireTemplate(@Param('id') id: string, @Body() dto: UpdateQuestionnaireTemplateDto) { return this.clinicalRulesService.updateQuestionnaireTemplate(id, dto); }

  @Audit({ action: 'CREATE_RULE_DRAFT_VERSION', target: 'DiseaseRuleTemplate', targetIdFrom: 'response.id' })
  @Post('templates/:id/clone-draft')
  @Roles(UserRole.ADMIN)
  cloneDraft(@Param('id') id: string, @Body() dto: CreateRuleVersionDto, @CurrentUser() user: RequestUser) { return this.clinicalRulesService.createDraftVersion(id, dto, user); }

  @Audit({ action: 'SUBMIT_RULE_FOR_PHYSICIAN_REVIEW', target: 'DiseaseRuleTemplate', targetIdFrom: 'params.id' })
  @Post('templates/:id/submit-review')
  @Roles(UserRole.ADMIN)
  submitReview(@Param('id') id: string, @Body() dto: ReviewRuleVersionDto) { return this.clinicalRulesService.submitForReview(id, dto); }

  @Audit({ action: 'APPROVE_RULE_VERSION', target: 'DiseaseRuleTemplate', targetIdFrom: 'params.id' })
  @Post('templates/:id/approve')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  approve(@Param('id') id: string, @Body() dto: ReviewRuleVersionDto, @CurrentUser() user: RequestUser) { return this.clinicalRulesService.approveVersion(id, dto, user); }

  @Audit({ action: 'PUBLISH_RULE_VERSION', target: 'DiseaseRuleTemplate', targetIdFrom: 'params.id' })
  @Post('templates/:id/publish')
  @Roles(UserRole.ADMIN)
  publish(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.clinicalRulesService.publishVersion(id, user); }

  @Audit({ action: 'ACTIVATE_RULE_VERSION', target: 'DiseaseRuleTemplate', targetIdFrom: 'params.id' })
  @Post('templates/:id/activate')
  @Roles(UserRole.ADMIN)
  activate(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.clinicalRulesService.activateVersion(id, user); }

  @Audit({ action: 'DEACTIVATE_RULE_VERSION', target: 'DiseaseRuleTemplate', targetIdFrom: 'params.id' })
  @Post('templates/:id/deactivate')
  @Roles(UserRole.ADMIN)
  deactivate(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.clinicalRulesService.deactivateVersion(id, user); }

  @Audit({ action: 'ROLLBACK_RULE_AS_NEW_DRAFT', target: 'DiseaseRuleTemplate', targetIdFrom: 'response.id' })
  @Post('templates/:id/rollback-as-draft')
  @Roles(UserRole.ADMIN)
  rollback(@Param('id') id: string, @Body() dto: CreateRuleVersionDto, @CurrentUser() user: RequestUser) { return this.clinicalRulesService.rollbackAsDraft(id, dto, user); }

  @Get('templates/:leftId/compare/:rightId')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  compare(@Param('leftId') leftId: string, @Param('rightId') rightId: string) { return this.clinicalRulesService.compareVersions(leftId, rightId); }

  @Post('templates/:id/simulate')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  simulate(@Param('id') id: string, @Body() dto: SimulateRuleDto) { return this.clinicalRulesService.simulateTemplate(id, dto); }

  @Get('templates/:id/estimate-impact')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  estimateImpact(@Param('id') id: string, @Query('days') days?: string) { return this.clinicalRulesService.estimateImpact(id, days ? Number(days) : 90); }
}

