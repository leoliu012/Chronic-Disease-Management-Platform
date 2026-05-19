import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { DiseaseProfilesService } from './disease-profiles.service';
import { CreateDiseaseProfileDto } from './dto/create-disease-profile.dto';
import { UpdateRiskLevelDto } from './dto/update-risk-level.dto';

@Controller()
export class DiseaseProfilesController {
  constructor(
    private readonly diseaseProfilesService: DiseaseProfilesService,
  ) {}

  @Post('patients/:patientId/disease-profiles')
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreateDiseaseProfileDto,
  ) {
    return this.diseaseProfilesService.create(patientId, dto);
  }

  @Get('patients/:patientId/disease-profiles')
  findByPatient(@Param('patientId') patientId: string) {
    return this.diseaseProfilesService.findByPatient(patientId);
  }

  @Get('disease-profiles/:id')
  findOne(@Param('id') id: string) {
    return this.diseaseProfilesService.findOne(id);
  }

  @Patch('disease-profiles/:id/risk-level')
  updateRiskLevel(
    @Param('id') id: string,
    @Body() dto: UpdateRiskLevelDto,
  ) {
    return this.diseaseProfilesService.updateRiskLevel(id, dto);
  }

  @Delete('disease-profiles/:id')
  remove(@Param('id') id: string) {
    return this.diseaseProfilesService.remove(id);
  }
}
