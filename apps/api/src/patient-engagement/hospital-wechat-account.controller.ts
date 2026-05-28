import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../security/roles.decorator';
import { CurrentUser } from '../security/current-user.decorator';
import type { RequestUser } from '../security/request-user.type';
import { AuditService } from '../security/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { HospitalWechatOfficialAccountService } from './hospital-wechat-account.service';
import { PatientEngagementTenantService } from './patient-engagement-tenant.service';
import { WechatOfficialAccountService } from './wechat-official-account.service';
import {
  TestAccessTokenDto,
  TestSendHospitalWechatDto,
  UpsertHospitalWechatAccountDto,
} from './dto/hospital-wechat-account.dto';

/**
 * /hospital-wechat/account              GET  — current tenant's config (masked)
 * /hospital-wechat/account              POST — upsert (ADMIN cross-tenant via hospitalTenantId)
 * /hospital-wechat/account/test-access-token POST — fetch (or mock) access_token
 * /hospital-wechat/account/test-send    POST — send a dummy template message to an openId
 *
 * 角色:
 *   - ADMIN                : 任意 hospitalTenantId
 *   - HOSPITAL_ADMIN/DOCTOR: 只能改自己 hospitalTenantId
 *   - NURSE                : 只读
 *   - MANAGER              : 只读
 */
@Controller('hospital-wechat')
export class HospitalWechatAccountController {
  constructor(
    private readonly accounts: HospitalWechatOfficialAccountService,
    private readonly wechat: WechatOfficialAccountService,
    private readonly tenant: PatientEngagementTenantService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('account')
  async getAccount(
    @Query('hospitalTenantId') hospitalTenantIdQ: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    const callerTenantId = await this.tenant.resolveUserHospitalTenantId(user);
    const target = this.accounts.resolveTargetTenantId({
      role: user.role,
      callerTenantId,
      requestedTenantId: hospitalTenantIdQ,
    });
    return this.accounts.getSummary(target);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @Post('account')
  async upsert(
    @Body() dto: UpsertHospitalWechatAccountDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    const callerTenantId = await this.tenant.resolveUserHospitalTenantId(user);
    const target = this.accounts.resolveTargetTenantId({
      role: user.role,
      callerTenantId,
      requestedTenantId: dto.hospitalTenantId,
    });
    if (!dto.appId) throw new BadRequestException('appId is required');

    // Only ADMIN may flip isVerified (since 认证 is hospital-side workflow tracked
    // out-of-band; doctors shouldn't be able to self-certify).
    const safeDto: any = { ...dto };
    if (user.role !== UserRole.ADMIN && 'isVerified' in safeDto) {
      delete safeDto.isVerified;
    }

    const updated = await this.accounts.upsert({
      hospitalTenantId: target,
      accountName: safeDto.accountName,
      originalId: safeDto.originalId,
      appId: safeDto.appId,
      appSecret: safeDto.appSecret,
      qrCodeUrl: safeDto.qrCodeUrl,
      h5BaseUrl: safeDto.h5BaseUrl,
      oauthCallbackDomain: safeDto.oauthCallbackDomain,
      templateQuestionnaireId: safeDto.templateQuestionnaireId,
      templateVitalId: safeDto.templateVitalId,
      templateMedicationId: safeDto.templateMedicationId,
      templateHospitalVisitId: safeDto.templateHospitalVisitId,
      isEnabled: safeDto.isEnabled,
      isVerified: safeDto.isVerified,
    });

    await this.audit.record({
      user,
      action: 'HOSPITAL_WECHAT_ACCOUNT_UPSERTED',
      targetType: 'HospitalWechatOfficialAccount',
      targetId: updated.id,
      ipAddress: req?.ip,
      afterData: {
        hospitalTenantId: target,
        appId: updated.appId,
        isEnabled: updated.isEnabled,
        isVerified: updated.isVerified,
        appSecretChanged: Boolean(dto.appSecret),
      },
    });

    return this.accounts.getSummary(target);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @Post('account/test-access-token')
  async testAccessToken(
    @Body() dto: TestAccessTokenDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    const callerTenantId = await this.tenant.resolveUserHospitalTenantId(user);
    const target = this.accounts.resolveTargetTenantId({
      role: user.role,
      callerTenantId,
      requestedTenantId: dto.hospitalTenantId,
    });
    const result = await this.accounts.testAccessToken(target);
    await this.audit.record({
      user,
      action: 'HOSPITAL_WECHAT_TEST_ACCESS_TOKEN',
      targetType: 'HospitalWechatOfficialAccount',
      targetId: target,
      ipAddress: req?.ip,
      afterData: { ok: result.ok, mocked: result.mocked },
    });
    return result;
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @Post('account/test-send')
  async testSend(
    @Body() dto: TestSendHospitalWechatDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    const callerTenantId = await this.tenant.resolveUserHospitalTenantId(user);
    const target = this.accounts.resolveTargetTenantId({
      role: user.role,
      callerTenantId,
      requestedTenantId: dto.hospitalTenantId,
    });

    let openId = dto.openId;
    let patientId = dto.patientId;
    if (!openId && patientId) {
      // Resolve via this tenant's identities only.
      await this.tenant.assertPatientVisibleToUser(patientId, user);
      const account = await this.accounts.getAccountForTenant(target);
      if (!account) throw new BadRequestException('该医院尚未配置服务号');
      const id = await this.prisma.patientWechatIdentity.findFirst({
        where: { patientId, hospitalTenantId: target, appId: account.appId, isVerified: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!id) throw new BadRequestException('该患者尚未在本院服务号中验证 openId');
      openId = id.openId;
    }
    if (!openId) throw new BadRequestException('请提供 openId 或 patientId');
    if (!patientId) patientId = 'test-send-' + Date.now();

    const result = await this.wechat.sendTemplateMessage({
      hospitalTenantId: target,
      patientId,
      openId,
      messageType: 'QUESTIONNAIRE_REMINDER',
      title: '【测试】本院服务号联通性测试',
      content: '这是一条来自本院服务号的连通性测试消息.',
      linkUrl: process.env.PATIENT_ENGAGEMENT_BASE_URL || 'http://localhost:5173',
    });

    await this.audit.record({
      user,
      action: 'HOSPITAL_WECHAT_TEST_SEND',
      targetType: 'HospitalWechatOfficialAccount',
      targetId: target,
      ipAddress: req?.ip,
      afterData: { ok: result.ok, mocked: result.mocked, openIdMask: openId.slice(0, 4) + '****' },
    });

    return result;
  }
}
