import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DataSource,
  DiseaseType,
  ExternalRecordStatus,
  Gender,
  IntegrationRecordStatus,
  IntegrationSyncStatus,
  IntegrationSystemType,
  Prisma,
  RiskLevel,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VitalRecordsService } from '../vital-records/vital-records.service';
import { UpdateFieldMappingDto } from './dto/update-field-mapping.dto';

type MockPatientPayload = {
  externalPatientId: string;
  hospitalPatientId: string;
  name: string;
  gender: Gender;
  birthDate?: string;
  phone?: string;
  idCardNo?: string;
  address?: string;
};

type MockDiagnosisPayload = {
  externalDiagnosisId: string;
  hospitalPatientId: string;
  diseaseType: DiseaseType;
  diagnosisDate?: string;
  diseaseStage?: string;
  complications?: string;
  comorbidities?: string;
  riskLevel: RiskLevel;
};

type MockLabPayload = {
  externalLabResultId: string;
  hospitalPatientId: string;
  labItemCode: string;
  labItemName: string;
  vitalType: string;
  value: number;
  unit: string;
  measuredAt: string;
};

type MockPrescriptionPayload = {
  externalPrescriptionId: string;
  hospitalPatientId: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  instructions?: string;
  startDate?: string;
  endDate?: string;
};

const integrationSources = [
  {
    id: 'integration-source-his-demo',
    code: 'HIS_DEMO',
    name: 'HIS 患者主索引模拟接口',
    systemType: IntegrationSystemType.HIS,
    description: '模拟医院 HIS 患者基本信息、院内号和就诊卡信息同步。',
  },
  {
    id: 'integration-source-emr-demo',
    code: 'EMR_DEMO',
    name: 'EMR 诊断病历模拟接口',
    systemType: IntegrationSystemType.EMR,
    description: '模拟 EMR 诊断、慢病病程、并发症和合并症同步。',
  },
  {
    id: 'integration-source-lis-demo',
    code: 'LIS_DEMO',
    name: 'LIS 检验结果模拟接口',
    systemType: IntegrationSystemType.LIS,
    description: '模拟 LIS 血糖、血脂、血氧等关键慢病指标同步。',
  },
  {
    id: 'integration-source-pharmacy-demo',
    code: 'PHARMACY_DEMO',
    name: '药房处方模拟接口',
    systemType: IntegrationSystemType.PHARMACY,
    description: '模拟处方用药、剂量、频次和医嘱说明同步。',
  },
];

const fieldMappings = [
  ['HIS_DEMO', 'Patient', 'PATIENT_ID', 'hospitalPatientId', '院内患者号', true],
  ['HIS_DEMO', 'Patient', 'PATIENT_NAME', 'name', '患者姓名', true],
  ['HIS_DEMO', 'Patient', 'GENDER_CODE', 'gender', '性别代码', false],
  ['HIS_DEMO', 'Patient', 'MOBILE_PHONE', 'phone', '手机号', false],
  ['HIS_DEMO', 'Patient', 'ID_CARD_NO', 'idCardNo', '身份证号', false],
  ['EMR_DEMO', 'DiseaseProfile', 'DIAGNOSIS_CODE', 'diseaseType', '慢病病种编码', true],
  ['EMR_DEMO', 'DiseaseProfile', 'DIAGNOSIS_DATE', 'diagnosisDate', '确诊日期', false],
  ['EMR_DEMO', 'DiseaseProfile', 'RISK_LEVEL', 'riskLevel', '风险等级', false],
  ['LIS_DEMO', 'VitalRecord', 'ITEM_CODE', 'type', '检验项目编码/指标类型', true],
  ['LIS_DEMO', 'VitalRecord', 'RESULT_VALUE', 'value', '检验结果数值', true],
  ['LIS_DEMO', 'VitalRecord', 'RESULT_UNIT', 'unit', '单位', true],
  ['LIS_DEMO', 'VitalRecord', 'REPORT_TIME', 'measuredAt', '报告时间', true],
  ['PHARMACY_DEMO', 'MedicationRecord', 'DRUG_NAME', 'medicationName', '药品名称', true],
  ['PHARMACY_DEMO', 'MedicationRecord', 'DOSAGE', 'dosage', '剂量', true],
  ['PHARMACY_DEMO', 'MedicationRecord', 'FREQUENCY', 'frequency', '频次', true],
] as const;

function daysAgo(days: number, hour = 9, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function yearsAgo(years: number, month = 0, day = 1) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years, month, day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vitalRecordsService: VitalRecordsService,
  ) {}

  private async resolveLocalHospitalTenantId(): Promise<string> {
    const configured = (process.env.LOCAL_HOSPITAL_TENANT_ID ?? '').trim();
    if (configured) {
      const tenant = await this.prisma.hospitalTenant.findUnique({
        where: { id: configured },
        select: { id: true, isActive: true },
      });
      if (!tenant?.isActive) {
        throw new Error(
          `LOCAL_HOSPITAL_TENANT_ID=${configured} does not reference an active HospitalTenant`,
        );
      }
      return tenant.id;
    }

    const tenants = await this.prisma.hospitalTenant.findMany({
      where: { isActive: true },
      select: { id: true },
      take: 2,
    });
    if (tenants.length !== 1) {
      throw new Error(
        'Integration demo sync requires LOCAL_HOSPITAL_TENANT_ID when active tenant count is not exactly one',
      );
    }
    return tenants[0].id;
  }

  async seedDefaults() {
    const hospitalTenantId = await this.resolveLocalHospitalTenantId();
    for (const source of integrationSources) {
      await this.prisma.integrationSource.upsert({
        where: {
          hospitalTenantId_code: {
            hospitalTenantId,
            code: source.code,
          },
        },
        update: {
          hospitalTenantId,
          name: source.name,
          systemType: source.systemType,
          description: source.description,
          isEnabled: true,
        },
        create: {
          ...source,
          hospitalTenantId,
        },
      });
    }

    for (const [sourceCode, targetModel, externalField, localField, displayName, isRequired] of fieldMappings) {
      const source = await this.prisma.integrationSource.findUnique({
        where: {
          hospitalTenantId_code: {
            hospitalTenantId,
            code: sourceCode,
          },
        },
      });
      if (!source) continue;

      await this.prisma.integrationFieldMapping.upsert({
        where: {
          sourceId_targetModel_externalField: {
            sourceId: source.id,
            targetModel,
            externalField,
          },
        },
        update: {
          localField,
          displayName,
          isRequired,
          isActive: true,
        },
        create: {
          sourceId: source.id,
          targetModel,
          externalField,
          localField,
          displayName,
          isRequired,
          isActive: true,
        },
      });
    }

    return {
      message: '接口来源和字段映射已初始化。',
      sources: integrationSources.length,
      mappings: fieldMappings.length,
    };
  }

  async getDashboard() {
    const [sources, recentBatches, failedRecords, mappingsCount] = await Promise.all([
      this.prisma.integrationSource.findMany({ orderBy: [{ systemType: 'asc' }, { code: 'asc' }] }),
      this.prisma.integrationSyncBatch.findMany({
        orderBy: { startedAt: 'desc' },
        take: 10,
        include: { source: true },
      }),
      this.prisma.integrationSyncRecord.findMany({
        where: { status: IntegrationRecordStatus.FAILED },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { source: true, batch: true },
      }),
      this.prisma.integrationFieldMapping.count({ where: { isActive: true } }),
    ]);

    return {
      sourceCount: sources.length,
      enabledSourceCount: sources.filter((source) => source.isEnabled).length,
      recentBatches,
      failedRecords,
      mappingsCount,
      sources,
    };
  }

  getSources() {
    return this.prisma.integrationSource.findMany({
      orderBy: [{ systemType: 'asc' }, { code: 'asc' }],
    });
  }

  getBatches() {
    return this.prisma.integrationSyncBatch.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { source: true },
    });
  }

  getRecords(batchId?: string) {
    return this.prisma.integrationSyncRecord.findMany({
      where: batchId ? { batchId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { source: true, batch: true },
    });
  }

  getFieldMappings() {
    return this.prisma.integrationFieldMapping.findMany({
      orderBy: [{ targetModel: 'asc' }, { externalField: 'asc' }],
      include: { source: true },
    });
  }

  async updateFieldMapping(id: string, dto: UpdateFieldMappingDto) {
    const existing = await this.prisma.integrationFieldMapping.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Integration field mapping not found');
    }

    return this.prisma.integrationFieldMapping.update({
      where: { id },
      data: {
        localField: dto.localField,
        displayName: dto.displayName,
        transformRule: dto.transformRule,
        defaultValue: dto.defaultValue,
        isRequired: dto.isRequired,
        isActive: dto.isActive,
      },
      include: { source: true },
    });
  }

  private async getSourceByCode(code: string) {
    const hospitalTenantId = await this.resolveLocalHospitalTenantId();
    const where = {
      hospitalTenantId_code: {
        hospitalTenantId,
        code,
      },
    };
    const source = await this.prisma.integrationSource.findUnique({ where });
    if (source) return source;
    await this.seedDefaults();
    const seeded = await this.prisma.integrationSource.findUnique({ where });
    if (!seeded) throw new NotFoundException(`Integration source ${code} not found`);
    return seeded;
  }

  private async createBatch(sourceId: string, batchType: string, operatorId?: string) {
    return this.prisma.integrationSyncBatch.create({
      data: {
        sourceId,
        batchType,
        status: IntegrationSyncStatus.RUNNING,
        startedAt: new Date(),
        operatorId,
      },
    });
  }

  private async writeSyncRecord(input: {
    sourceId: string;
    batchId: string;
    externalRecordType: string;
    externalRecordId: string;
    localTargetType?: string;
    localTargetId?: string;
    status: IntegrationRecordStatus;
    errorMessage?: string;
    rawData?: unknown;
    normalizedData?: unknown;
  }) {
    return this.prisma.integrationSyncRecord.create({
      data: {
        sourceId: input.sourceId,
        batchId: input.batchId,
        externalRecordType: input.externalRecordType,
        externalRecordId: input.externalRecordId,
        localTargetType: input.localTargetType,
        localTargetId: input.localTargetId,
        status: input.status,
        errorMessage: input.errorMessage,
        rawData: input.rawData === undefined ? undefined : asJson(input.rawData),
        normalizedData: input.normalizedData === undefined ? undefined : asJson(input.normalizedData),
      },
    });
  }

  private async finishBatch(batchId: string, totalCount: number, successCount: number, failedCount: number) {
    const status = failedCount === 0
      ? IntegrationSyncStatus.SUCCESS
      : successCount === 0
        ? IntegrationSyncStatus.FAILED
        : IntegrationSyncStatus.PARTIAL_FAILED;

    return this.prisma.integrationSyncBatch.update({
      where: { id: batchId },
      data: {
        status,
        totalCount,
        successCount,
        failedCount,
        finishedAt: new Date(),
        message: `同步完成：成功 ${successCount} 条，失败 ${failedCount} 条。`,
      },
      include: { source: true, records: true },
    });
  }

  private getMockHisPatients(): MockPatientPayload[] {
    return [
      {
        externalPatientId: 'HIS-P-001',
        hospitalPatientId: 'MZ20260519001',
        name: '王建国',
        gender: Gender.MALE,
        birthDate: yearsAgo(68, 2, 14),
        phone: '13800010001',
        idCardNo: '610102195803140011',
        address: '碑林区长乐坊社区',
      },
      {
        externalPatientId: 'HIS-P-011',
        hospitalPatientId: 'MZ20260519011',
        name: '韩梅',
        gender: Gender.FEMALE,
        birthDate: yearsAgo(58, 7, 11),
        phone: '13800010011',
        idCardNo: '610112196808110111',
        address: '碑林区柏树林社区',
      },
      {
        externalPatientId: 'HIS-P-012',
        hospitalPatientId: 'MZ20260519012',
        name: '马建军',
        gender: Gender.MALE,
        birthDate: yearsAgo(65, 5, 20),
        phone: '13800010012',
        idCardNo: '610113196106200122',
        address: '雁塔区小寨社区',
      },
    ];
  }

  private getMockEmrDiagnoses(): MockDiagnosisPayload[] {
    return [
      {
        externalDiagnosisId: 'EMR-D-001',
        hospitalPatientId: 'MZ20260519011',
        diseaseType: DiseaseType.HYPERTENSION,
        diagnosisDate: daysAgo(90),
        diseaseStage: '2级高血压，院内门诊确诊',
        complications: '靶器官损害风险待评估',
        comorbidities: '高脂血症',
        riskLevel: RiskLevel.HIGH,
      },
      {
        externalDiagnosisId: 'EMR-D-002',
        hospitalPatientId: 'MZ20260519012',
        diseaseType: DiseaseType.TYPE_2_DIABETES,
        diagnosisDate: daysAgo(180),
        diseaseStage: '2型糖尿病，口服药治疗中',
        complications: '周围神经病变风险',
        comorbidities: '肥胖',
        riskLevel: RiskLevel.HIGH,
      },
      {
        externalDiagnosisId: 'EMR-D-003',
        hospitalPatientId: 'MZ20260519003',
        diseaseType: DiseaseType.COPD,
        diagnosisDate: daysAgo(240),
        diseaseStage: '慢阻肺稳定期复诊记录',
        complications: '近期活动后气促',
        comorbidities: '冠心病',
        riskLevel: RiskLevel.HIGH,
      },
    ];
  }

  private getMockLisResults(): MockLabPayload[] {
    return [
      {
        externalLabResultId: 'LIS-R-001',
        hospitalPatientId: 'MZ20260519012',
        labItemCode: 'FPG',
        labItemName: '空腹血糖',
        vitalType: 'BLOOD_GLUCOSE',
        value: 13.6,
        unit: 'mmol/L',
        measuredAt: daysAgo(0, 8, 20),
      },
      {
        externalLabResultId: 'LIS-R-002',
        hospitalPatientId: 'MZ20260519011',
        labItemCode: 'SBP',
        labItemName: '门诊收缩压',
        vitalType: 'SYSTOLIC_BP',
        value: 166,
        unit: 'mmHg',
        measuredAt: daysAgo(0, 9, 5),
      },
      {
        externalLabResultId: 'LIS-R-003',
        hospitalPatientId: 'MZ20260519003',
        labItemCode: 'SPO2',
        labItemName: '血氧饱和度',
        vitalType: 'SPO2',
        value: 92,
        unit: '%',
        measuredAt: daysAgo(0, 10, 10),
      },
    ];
  }

  private getMockPharmacyPrescriptions(): MockPrescriptionPayload[] {
    return [
      {
        externalPrescriptionId: 'PHA-RX-001',
        hospitalPatientId: 'MZ20260519011',
        medicationName: '苯磺酸氨氯地平片',
        dosage: '5mg',
        frequency: '每日 1 次，饭后服用',
        instructions: '门诊处方同步：每日晨起后服用。',
        startDate: daysAgo(5),
      },
      {
        externalPrescriptionId: 'PHA-RX-002',
        hospitalPatientId: 'MZ20260519012',
        medicationName: '二甲双胍片',
        dosage: '500mg',
        frequency: '每日 2 次，随餐服用',
        instructions: '门诊处方同步：如低血糖及时联系护士。',
        startDate: daysAgo(5),
      },
      {
        externalPrescriptionId: 'PHA-RX-003',
        hospitalPatientId: 'MZ20260519003',
        medicationName: '噻托溴铵吸入剂',
        dosage: '18μg',
        frequency: '每日 1 次',
        instructions: '药房处方同步：按吸入装置规范使用。',
        startDate: daysAgo(7),
      },
    ];
  }

  async mockSyncHisPatients(operatorId?: string) {
    const source = await this.getSourceByCode('HIS_DEMO');
    const batch = await this.createBatch(source.id, 'HIS_PATIENTS', operatorId);
    const payload = this.getMockHisPatients();
    let successCount = 0;
    let failedCount = 0;

    for (const item of payload) {
      try {
        const patient = await this.prisma.patient.upsert({
          where: {
            hospitalTenantId_hospitalPatientId: {
              hospitalTenantId: source.hospitalTenantId,
              hospitalPatientId: item.hospitalPatientId,
            },
          },
          update: {
            name: item.name,
            gender: item.gender,
            birthDate: item.birthDate ? new Date(item.birthDate) : undefined,
            phone: item.phone,
            idCardNo: item.idCardNo,
            address: item.address,
            responsibleDoctorId: undefined,
            responsibleNurseId: undefined,
          },
          create: {
            hospitalTenantId: source.hospitalTenantId,
            hospitalPatientId: item.hospitalPatientId,
            name: item.name,
            gender: item.gender,
            birthDate: item.birthDate ? new Date(item.birthDate) : undefined,
            phone: item.phone,
            idCardNo: item.idCardNo,
            address: item.address,
            responsibleDoctorId: undefined,
            responsibleNurseId: undefined,
          },
        });

        await this.prisma.externalPatientRecord.upsert({
          where: {
            sourceId_externalPatientId: {
              sourceId: source.id,
              externalPatientId: item.externalPatientId,
            },
          },
          update: {
            hospitalPatientId: item.hospitalPatientId,
            name: item.name,
            gender: item.gender,
            birthDate: item.birthDate ? new Date(item.birthDate) : undefined,
            phone: item.phone,
            idCardNo: item.idCardNo,
            address: item.address,
            rawData: asJson(item),
            importStatus: ExternalRecordStatus.IMPORTED,
            localPatientId: patient.id,
            errorMessage: null,
          },
          create: {
            sourceId: source.id,
            externalPatientId: item.externalPatientId,
            hospitalPatientId: item.hospitalPatientId,
            name: item.name,
            gender: item.gender,
            birthDate: item.birthDate ? new Date(item.birthDate) : undefined,
            phone: item.phone,
            idCardNo: item.idCardNo,
            address: item.address,
            rawData: asJson(item),
            importStatus: ExternalRecordStatus.IMPORTED,
            localPatientId: patient.id,
          },
        });

        await this.writeSyncRecord({
          sourceId: source.id,
          batchId: batch.id,
          externalRecordType: 'HIS_PATIENT',
          externalRecordId: item.externalPatientId,
          localTargetType: 'Patient',
          localTargetId: patient.id,
          status: IntegrationRecordStatus.SUCCESS,
          rawData: item,
          normalizedData: patient,
        });
        successCount += 1;
      } catch (error: any) {
        failedCount += 1;
        await this.writeSyncRecord({
          sourceId: source.id,
          batchId: batch.id,
          externalRecordType: 'HIS_PATIENT',
          externalRecordId: item.externalPatientId,
          status: IntegrationRecordStatus.FAILED,
          errorMessage: error?.message ?? '同步患者失败',
          rawData: item,
        });
      }
    }

    return this.finishBatch(batch.id, payload.length, successCount, failedCount);
  }

  async mockSyncEmrDiagnoses(operatorId?: string) {
    const source = await this.getSourceByCode('EMR_DEMO');
    const batch = await this.createBatch(source.id, 'EMR_DIAGNOSES', operatorId);
    const payload = this.getMockEmrDiagnoses();
    let successCount = 0;
    let failedCount = 0;

    for (const item of payload) {
      try {
        const patient = await this.prisma.patient.findUnique({
          where: {
            hospitalTenantId_hospitalPatientId: {
              hospitalTenantId: source.hospitalTenantId,
              hospitalPatientId: item.hospitalPatientId,
            },
          },
        });
        if (!patient) throw new Error(`未找到院内号 ${item.hospitalPatientId} 对应患者，请先同步 HIS 患者。`);

        const existing = await this.prisma.diseaseProfile.findFirst({
          where: { patientId: patient.id, diseaseType: item.diseaseType },
        });

        const diseaseProfile = existing
          ? await this.prisma.diseaseProfile.update({
              where: { id: existing.id },
              data: {
                diagnosisDate: item.diagnosisDate ? new Date(item.diagnosisDate) : undefined,
                diseaseStage: item.diseaseStage,
                complications: item.complications,
                comorbidities: item.comorbidities,
                riskLevel: item.riskLevel,
                dataSource: DataSource.EMR,
              },
            })
          : await this.prisma.diseaseProfile.create({
              data: {
                patientId: patient.id,
                diseaseType: item.diseaseType,
                diagnosisDate: item.diagnosisDate ? new Date(item.diagnosisDate) : undefined,
                diseaseStage: item.diseaseStage,
                complications: item.complications,
                comorbidities: item.comorbidities,
                riskLevel: item.riskLevel,
                dataSource: DataSource.EMR,
              },
            });

        await this.prisma.externalDiagnosisRecord.upsert({
          where: {
            sourceId_externalDiagnosisId: {
              sourceId: source.id,
              externalDiagnosisId: item.externalDiagnosisId,
            },
          },
          update: {
            hospitalPatientId: item.hospitalPatientId,
            diseaseType: item.diseaseType,
            diagnosisDate: item.diagnosisDate ? new Date(item.diagnosisDate) : undefined,
            diseaseStage: item.diseaseStage,
            complications: item.complications,
            comorbidities: item.comorbidities,
            riskLevel: item.riskLevel,
            rawData: asJson(item),
            importStatus: ExternalRecordStatus.IMPORTED,
            localDiseaseProfileId: diseaseProfile.id,
            errorMessage: null,
          },
          create: {
            sourceId: source.id,
            externalDiagnosisId: item.externalDiagnosisId,
            hospitalPatientId: item.hospitalPatientId,
            diseaseType: item.diseaseType,
            diagnosisDate: item.diagnosisDate ? new Date(item.diagnosisDate) : undefined,
            diseaseStage: item.diseaseStage,
            complications: item.complications,
            comorbidities: item.comorbidities,
            riskLevel: item.riskLevel,
            rawData: asJson(item),
            importStatus: ExternalRecordStatus.IMPORTED,
            localDiseaseProfileId: diseaseProfile.id,
          },
        });

        await this.writeSyncRecord({
          sourceId: source.id,
          batchId: batch.id,
          externalRecordType: 'EMR_DIAGNOSIS',
          externalRecordId: item.externalDiagnosisId,
          localTargetType: 'DiseaseProfile',
          localTargetId: diseaseProfile.id,
          status: IntegrationRecordStatus.SUCCESS,
          rawData: item,
          normalizedData: diseaseProfile,
        });
        successCount += 1;
      } catch (error: any) {
        failedCount += 1;
        await this.writeSyncRecord({
          sourceId: source.id,
          batchId: batch.id,
          externalRecordType: 'EMR_DIAGNOSIS',
          externalRecordId: item.externalDiagnosisId,
          status: IntegrationRecordStatus.FAILED,
          errorMessage: error?.message ?? '同步诊断失败',
          rawData: item,
        });
      }
    }

    return this.finishBatch(batch.id, payload.length, successCount, failedCount);
  }

  async mockSyncLisResults(operatorId?: string) {
    const source = await this.getSourceByCode('LIS_DEMO');
    const batch = await this.createBatch(source.id, 'LIS_RESULTS', operatorId);
    const payload = this.getMockLisResults();
    let successCount = 0;
    let failedCount = 0;

    for (const item of payload) {
      try {
        const patient = await this.prisma.patient.findUnique({
          where: {
            hospitalTenantId_hospitalPatientId: {
              hospitalTenantId: source.hospitalTenantId,
              hospitalPatientId: item.hospitalPatientId,
            },
          },
        });
        if (!patient) throw new Error(`未找到院内号 ${item.hospitalPatientId} 对应患者，请先同步 HIS 患者。`);

        const vitalRecord = await this.vitalRecordsService.create(patient.id, {
          type: item.vitalType,
          value: item.value,
          unit: item.unit,
          measuredAt: item.measuredAt,
          dataSource: DataSource.LIS,
          note: `LIS 同步：${item.labItemName}（${item.labItemCode}）`,
        });

        const vitalRecordId = (vitalRecord as any)?.vitalRecord?.id ?? (vitalRecord as any)?.id;

        await this.prisma.externalLabResultRecord.upsert({
          where: {
            sourceId_externalLabResultId: {
              sourceId: source.id,
              externalLabResultId: item.externalLabResultId,
            },
          },
          update: {
            hospitalPatientId: item.hospitalPatientId,
            labItemCode: item.labItemCode,
            labItemName: item.labItemName,
            vitalType: item.vitalType,
            value: item.value,
            unit: item.unit,
            measuredAt: new Date(item.measuredAt),
            rawData: asJson(item),
            importStatus: ExternalRecordStatus.IMPORTED,
            localVitalRecordId: vitalRecordId,
            errorMessage: null,
          },
          create: {
            sourceId: source.id,
            externalLabResultId: item.externalLabResultId,
            hospitalPatientId: item.hospitalPatientId,
            labItemCode: item.labItemCode,
            labItemName: item.labItemName,
            vitalType: item.vitalType,
            value: item.value,
            unit: item.unit,
            measuredAt: new Date(item.measuredAt),
            rawData: asJson(item),
            importStatus: ExternalRecordStatus.IMPORTED,
            localVitalRecordId: vitalRecordId,
          },
        });

        await this.writeSyncRecord({
          sourceId: source.id,
          batchId: batch.id,
          externalRecordType: 'LIS_RESULT',
          externalRecordId: item.externalLabResultId,
          localTargetType: 'VitalRecord',
          localTargetId: vitalRecordId,
          status: IntegrationRecordStatus.SUCCESS,
          rawData: item,
          normalizedData: vitalRecord,
        });
        successCount += 1;
      } catch (error: any) {
        failedCount += 1;
        await this.writeSyncRecord({
          sourceId: source.id,
          batchId: batch.id,
          externalRecordType: 'LIS_RESULT',
          externalRecordId: item.externalLabResultId,
          status: IntegrationRecordStatus.FAILED,
          errorMessage: error?.message ?? '同步 LIS 检验失败',
          rawData: item,
        });
      }
    }

    return this.finishBatch(batch.id, payload.length, successCount, failedCount);
  }

  async mockSyncPrescriptions(operatorId?: string) {
    const source = await this.getSourceByCode('PHARMACY_DEMO');
    const batch = await this.createBatch(source.id, 'PRESCRIPTIONS', operatorId);
    const payload = this.getMockPharmacyPrescriptions();
    let successCount = 0;
    let failedCount = 0;

    for (const item of payload) {
      try {
        const patient = await this.prisma.patient.findUnique({
          where: {
            hospitalTenantId_hospitalPatientId: {
              hospitalTenantId: source.hospitalTenantId,
              hospitalPatientId: item.hospitalPatientId,
            },
          },
        });
        if (!patient) throw new Error(`未找到院内号 ${item.hospitalPatientId} 对应患者，请先同步 HIS 患者。`);

        const existing = await this.prisma.medicationRecord.findFirst({
          where: { patientId: patient.id, medicationName: item.medicationName },
        });

        const medicationRecord = existing
          ? await this.prisma.medicationRecord.update({
              where: { id: existing.id },
              data: {
                dosage: item.dosage,
                frequency: item.frequency,
                instructions: item.instructions,
                startDate: item.startDate ? new Date(item.startDate) : undefined,
                endDate: item.endDate ? new Date(item.endDate) : undefined,
                dataSource: DataSource.HIS,
                isActive: true,
              },
            })
          : await this.prisma.medicationRecord.create({
              data: {
                patientId: patient.id,
                medicationName: item.medicationName,
                dosage: item.dosage,
                frequency: item.frequency,
                frequencyUnit: 'DAY',
                timesPerUnit: item.frequency.includes('2') ? 2 : 1,
                timingRelation: item.frequency.includes('饭后') ? 'AFTER_MEAL' : 'NONE',
                instructions: item.instructions,
                startDate: item.startDate ? new Date(item.startDate) : undefined,
                endDate: item.endDate ? new Date(item.endDate) : undefined,
                dataSource: DataSource.HIS,
                isActive: true,
              },
            });

        await this.prisma.externalPrescriptionRecord.upsert({
          where: {
            sourceId_externalPrescriptionId: {
              sourceId: source.id,
              externalPrescriptionId: item.externalPrescriptionId,
            },
          },
          update: {
            hospitalPatientId: item.hospitalPatientId,
            medicationName: item.medicationName,
            dosage: item.dosage,
            frequency: item.frequency,
            instructions: item.instructions,
            startDate: item.startDate ? new Date(item.startDate) : undefined,
            endDate: item.endDate ? new Date(item.endDate) : undefined,
            rawData: asJson(item),
            importStatus: ExternalRecordStatus.IMPORTED,
            localMedicationRecordId: medicationRecord.id,
            errorMessage: null,
          },
          create: {
            sourceId: source.id,
            externalPrescriptionId: item.externalPrescriptionId,
            hospitalPatientId: item.hospitalPatientId,
            medicationName: item.medicationName,
            dosage: item.dosage,
            frequency: item.frequency,
            instructions: item.instructions,
            startDate: item.startDate ? new Date(item.startDate) : undefined,
            endDate: item.endDate ? new Date(item.endDate) : undefined,
            rawData: asJson(item),
            importStatus: ExternalRecordStatus.IMPORTED,
            localMedicationRecordId: medicationRecord.id,
          },
        });

        await this.writeSyncRecord({
          sourceId: source.id,
          batchId: batch.id,
          externalRecordType: 'PRESCRIPTION',
          externalRecordId: item.externalPrescriptionId,
          localTargetType: 'MedicationRecord',
          localTargetId: medicationRecord.id,
          status: IntegrationRecordStatus.SUCCESS,
          rawData: item,
          normalizedData: medicationRecord,
        });
        successCount += 1;
      } catch (error: any) {
        failedCount += 1;
        await this.writeSyncRecord({
          sourceId: source.id,
          batchId: batch.id,
          externalRecordType: 'PRESCRIPTION',
          externalRecordId: item.externalPrescriptionId,
          status: IntegrationRecordStatus.FAILED,
          errorMessage: error?.message ?? '同步处方失败',
          rawData: item,
        });
      }
    }

    return this.finishBatch(batch.id, payload.length, successCount, failedCount);
  }
}


