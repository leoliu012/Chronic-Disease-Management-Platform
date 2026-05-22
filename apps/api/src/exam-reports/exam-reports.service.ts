import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExamReportDto } from './dto/create-exam-report.dto';

@Injectable()
export class ExamReportsService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateExamReportDto) {
    const { patientId, examTime, ...rest } = createDto;

    // Verify patient exists
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException(`Patient with ID ${patientId} not found`);
    }

    return this.prisma.examReportRecord.create({
      data: {
        patientId,
        examTime: new Date(examTime),
        ...rest,
      },
    });
  }

  async findAllByPatient(patientId: string) {
    return this.prisma.examReportRecord.findMany({
      where: { patientId },
      orderBy: { examTime: 'desc' },
    });
  }

  async findOne(id: string) {
    const record = await this.prisma.examReportRecord.findUnique({
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
      throw new NotFoundException(`Exam report with ID ${id} not found`);
    }

    return record;
  }

  async findRecent(patientId: string, limit: number = 5) {
    return this.prisma.examReportRecord.findMany({
      where: { patientId },
      orderBy: { examTime: 'desc' },
      take: limit,
    });
  }
}
