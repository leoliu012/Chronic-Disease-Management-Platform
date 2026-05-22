import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEncounterRecordDto } from './dto/create-encounter-record.dto';

@Injectable()
export class EncounterRecordsService {
  constructor(private prisma: PrismaService) {}

  async create(createEncounterRecordDto: CreateEncounterRecordDto) {
    const { patientId, visitTime, ...rest } = createEncounterRecordDto;

    // Verify patient exists
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException(`Patient with ID ${patientId} not found`);
    }

    return this.prisma.encounterRecord.create({
      data: {
        patientId,
        visitTime: new Date(visitTime),
        ...rest,
      },
    });
  }

  async findAllByPatient(patientId: string) {
    return this.prisma.encounterRecord.findMany({
      where: { patientId },
      orderBy: { visitTime: 'desc' },
    });
  }

  async findOne(id: string) {
    const record = await this.prisma.encounterRecord.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            name: true,
            hospitalPatientId: true,
          },
        },
        hospitalMedicationOrders: {
          orderBy: { prescribedAt: 'desc' },
        },
      },
    });

    if (!record) {
      throw new NotFoundException(`Encounter record with ID ${id} not found`);
    }

    return record;
  }

  async findRecent(patientId: string, limit: number = 5) {
    return this.prisma.encounterRecord.findMany({
      where: { patientId },
      orderBy: { visitTime: 'desc' },
      take: limit,
    });
  }
}
