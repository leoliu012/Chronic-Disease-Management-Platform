import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';

@Injectable()
export class FollowUpsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(patientId: string, dto: CreateFollowUpDto) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    return this.prisma.followUpRecord.create({
      data: {
        patientId,
        followUpType: dto.followUpType,
        followUpTime: new Date(dto.followUpTime),
        content: dto.content,
        result: dto.result,
        suggestion: dto.suggestion,
        nextFollowUpTime: dto.nextFollowUpTime
          ? new Date(dto.nextFollowUpTime)
          : undefined,
        operatorId: dto.operatorId,
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

    return this.prisma.followUpRecord.findMany({
      where: { patientId },
      orderBy: {
        followUpTime: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const followUp = await this.prisma.followUpRecord.findUnique({
      where: { id },
      include: {
        patient: true,
      },
    });

    if (!followUp) {
      throw new NotFoundException('Follow-up record not found');
    }

    return followUp;
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.followUpRecord.delete({
      where: { id },
    });
  }
}
