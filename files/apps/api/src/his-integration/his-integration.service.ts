import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImportHisPatientDto } from './dto/import-his-patient.dto';
import { ClinicalAccessScopeService } from '../security/clinical-access-scope.service';
import type { RequestUser } from '../security/request-user.type';

@Injectable()
export class HisIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClinicalAccessScopeService,
  ) {}

  private normalizeIdentifier(value?: string) {
    return value?.trim();
  }

  async lookupPatientByBarcode(rawBarcode: string, user: RequestUser) {
    const barcode = this.normalizeIdentifier(rawBarcode);

    if (!barcode) {
      throw new BadRequestException('Barcode is required');
    }

    const patientScope = await this.access.buildPatientScope(user);
    const existingPatient = await this.prisma.patient.findFirst({
      where: {
        AND: [
          patientScope,
          {
            OR: [
              { hospitalPatientId: barcode },
              { idCardNo: barcode },
              { phone: barcode },
            ],
          },
        ],
      },
      include: {
        diseaseProfiles: true,
        vitalRecords: {
          orderBy: { measuredAt: 'desc' },
          take: 5,
        },
        tasks: {
          where: { status: 'PENDING' },
          orderBy: { dueAt: 'asc' },
        },
      },
    });

    if (existingPatient) {
      return {
        sourceSystem: 'LOCAL_CACHE',
        interfaceStatus: 'MATCHED_LOCAL_PATIENT',
        message: '已在本平台患者主索引中匹配到该条码/院内号。',
        patient: existingPatient,
      };
    }

    return this.buildReservedHisDraft(barcode);
  }

  /**
   * Patient self-binding is a deliberately separate trust boundary. It must not
   * perform an unscoped local Patient-table lookup. The current HIS adapter is a
   * reserved mock, so return only an empty staged draft. A real HIS adapter must
   * add hospital routing and an identity challenge before returning PHI.
   */
  async lookupPatientByBarcodeForPatientSelfBind(rawBarcode: string) {
    const barcode = this.normalizeIdentifier(rawBarcode);
    if (!barcode) throw new BadRequestException('Barcode is required');
    return this.buildReservedHisDraft(barcode);
  }

  private buildReservedHisDraft(barcode: string) {
    return {
      sourceSystem: 'HIS_RESERVED_INTERFACE',
      interfaceStatus: 'MOCK_PENDING_REAL_HIS',
      message:
        '当前为 HIS 条码接口预留模式：真实上线时这里应调用医院 HIS 患者主索引/就诊卡接口。',
      patient: {
        hospitalPatientId: barcode,
        name: '',
        gender: 'UNKNOWN',
        birthDate: null,
        phone: '',
        idCardNo: '',
        address: '',
        responsibleDoctorId: undefined,
        responsibleNurseId: undefined,
      },
    };
  }

  async importPatientDraft(dto: ImportHisPatientDto, user: RequestUser) {
    const identifier = this.normalizeIdentifier(dto.barcode ?? dto.hospitalPatientId);

    if (!identifier) {
      throw new BadRequestException('barcode or hospitalPatientId is required');
    }

    const lookupResult = await this.lookupPatientByBarcode(identifier, user);

    return {
      ...lookupResult,
      importMode: 'DRAFT_ONLY',
      message:
        lookupResult.interfaceStatus === 'MATCHED_LOCAL_PATIENT'
          ? '已匹配本地患者，可直接进入档案。'
          : '已生成 HIS 患者草稿。请补充姓名等必要字段后保存到慢病平台。',
    };
  }

  async exportPatientsForHis(user: RequestUser, hospitalTenantId?: string) {
    const patients = await this.prisma.patient.findMany({
      where: await this.access.buildPatientScope(user, hospitalTenantId),
      orderBy: { createdAt: 'desc' },
      include: {
        diseaseProfiles: true,
        vitalRecords: {
          orderBy: { measuredAt: 'desc' },
          take: 3,
        },
        followUps: {
          orderBy: { followUpTime: 'desc' },
          take: 3,
        },
        tasks: {
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
      },
    });

    return {
      sourceSystem: 'CHRONIC_CARE_PLATFORM',
      targetSystem: 'HIS_RESERVED_INTERFACE',
      interfaceStatus: 'EXPORT_PAYLOAD_READY',
      message:
        '当前为 HIS 导出接口预留模式：真实上线时可改为 HL7/FHIR/WebService/中间库/数据库视图推送。',
      exportedAt: new Date().toISOString(),
      count: patients.length,
      patients,
    };
  }
}


