import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHospitalMedicationDto } from './dto/create-hospital-medication.dto';

@Injectable()
export class HospitalMedicationsService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateHospitalMedicationDto) {
    const { patientId, prescribedAt, ...rest } = createDto;

    // Verify patient exists
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException(`Patient with ID ${patientId} not found`);
    }

    return this.prisma.hospitalMedicationOrder.create({
      data: {
        patientId,
        prescribedAt: new Date(prescribedAt),
        ...rest,
      },
    });
  }

  async findAllByPatient(patientId: string) {
    return this.prisma.hospitalMedicationOrder.findMany({
      where: { patientId },
      orderBy: { prescribedAt: 'desc' },
      include: {
        encounterRecord: {
          select: {
            id: true,
            visitType: true,
            visitTime: true,
            departmentName: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const record = await this.prisma.hospitalMedicationOrder.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            name: true,
            hospitalPatientId: true,
          },
        },
        encounterRecord: true,
      },
    });

    if (!record) {
      throw new NotFoundException(`Hospital medication order with ID ${id} not found`);
    }

    return record;
  }

  async findRecent(patientId: string, limit: number = 10) {
    return this.prisma.hospitalMedicationOrder.findMany({
      where: { patientId },
      orderBy: { prescribedAt: 'desc' },
      take: limit,
    });
  }
}
