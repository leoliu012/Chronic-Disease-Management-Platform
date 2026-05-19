import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDiseaseProfileDto } from './dto/create-disease-profile.dto';
import { UpdateRiskLevelDto } from './dto/update-risk-level.dto';

@Injectable()
export class DiseaseProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(patientId: string, dto: CreateDiseaseProfileDto) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    return this.prisma.diseaseProfile.create({
      data: {
        patientId,
        diseaseType: dto.diseaseType,
        diagnosisDate: dto.diagnosisDate
          ? new Date(dto.diagnosisDate)
          : undefined,
        diseaseStage: dto.diseaseStage,
        complications: dto.complications,
        comorbidities: dto.comorbidities,
        riskLevel: dto.riskLevel,
        dataSource: dto.dataSource,
      },
    });
  }

  async findByPatient(patientId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    return this.prisma.diseaseProfile.findMany({
      where: { patientId },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const diseaseProfile = await this.prisma.diseaseProfile.findUnique({
      where: { id },
      include: {
        patient: true,
      },
    });

    if (!diseaseProfile) {
      throw new NotFoundException('Disease profile not found');
    }

    return diseaseProfile;
  }

  async updateRiskLevel(id: string, dto: UpdateRiskLevelDto) {
    await this.findOne(id);

    return this.prisma.diseaseProfile.update({
      where: { id },
      data: {
        riskLevel: dto.riskLevel,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.diseaseProfile.delete({
      where: { id },
    });
  }
}
