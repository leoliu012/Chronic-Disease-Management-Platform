import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImportHisPatientDto } from './dto/import-his-patient.dto';

@Injectable()
export class HisIntegrationService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeIdentifier(value?: string) {
    return value?.trim();
  }

  async lookupPatientByBarcode(rawBarcode: string) {
    const barcode = this.normalizeIdentifier(rawBarcode);

    if (!barcode) {
      throw new BadRequestException('Barcode is required');
    }

    const existingPatient = await this.prisma.patient.findFirst({
      where: {
        OR: [
          { hospitalPatientId: barcode },
          { idCardNo: barcode },
          { phone: barcode },
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
        responsibleDoctorId: 'doctor-001',
        responsibleNurseId: 'nurse-001',
      },
    };
  }

  async importPatientDraft(dto: ImportHisPatientDto) {
    const identifier = this.normalizeIdentifier(dto.barcode ?? dto.hospitalPatientId);

    if (!identifier) {
      throw new BadRequestException('barcode or hospitalPatientId is required');
    }

    const lookupResult = await this.lookupPatientByBarcode(identifier);

    return {
      ...lookupResult,
      importMode: 'DRAFT_ONLY',
      message:
        lookupResult.interfaceStatus === 'MATCHED_LOCAL_PATIENT'
          ? '已匹配本地患者，可直接进入档案。'
          : '已生成 HIS 患者草稿。请补充姓名等必要字段后保存到慢病平台。',
    };
  }

  async exportPatientsForHis() {
    const patients = await this.prisma.patient.findMany({
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
