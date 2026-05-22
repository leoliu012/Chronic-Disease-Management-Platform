import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMedicalRecordSummaryDto } from './dto/create-medical-record-summary.dto';

@Injectable()
export class MedicalRecordSummariesService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateMedicalRecordSummaryDto) {
    const { patientId, recordTime, ...rest } = createDto;

    // Verify patient exists
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException(`Patient with ID ${patientId} not found`);
    }

    return this.prisma.medicalRecordSummary.create({
      data: {
        patientId,
        recordTime: new Date(recordTime),
        ...rest,
      },
    });
  }

  async findAllByPatient(patientId: string) {
    return this.prisma.medicalRecordSummary.findMany({
      where: { patientId },
      orderBy: { recordTime: 'desc' },
    });
  }

  async findOne(id: string) {
    const record = await this.prisma.medicalRecordSummary.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            name: true,
            hospitalPatientId: true,
          },
        },
      },
    });

    if (!record) {
      throw new NotFoundException(`Medical record summary with ID ${id} not found`);
    }

    return record;
  }

  async findRecent(patientId: string, limit: number = 5) {
    return this.prisma.medicalRecordSummary.findMany({
      where: { patientId },
      orderBy: { recordTime: 'desc' },
      take: limit,
    });
  }
}
