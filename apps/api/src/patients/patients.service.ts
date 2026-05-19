import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePatientDto } from './dto/create-patient.dto';

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePatientDto) {
    return this.prisma.patient.create({
      data: {
        ...dto,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
      },
    });
  }

  async findAll() {
    return this.prisma.patient.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        diseaseProfiles: true,
        vitalRecords: {
          orderBy: {
            measuredAt: 'desc',
          },
          take: 5,
        },
        tasks: {
          where: {
            status: 'PENDING',
          },
          orderBy: {
            dueAt: 'asc',
          },
        },
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.patient.findUnique({
      where: { id },
      include: {
        diseaseProfiles: true,
        vitalRecords: {
          orderBy: {
            measuredAt: 'desc',
          },
        },
        followUps: {
          orderBy: {
            followUpTime: 'desc',
          },
        },
        tasks: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
  }
}