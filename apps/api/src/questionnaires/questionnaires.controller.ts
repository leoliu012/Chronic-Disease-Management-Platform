import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { QuestionnairesService } from './questionnaires.service';
import { CreateQuestionnaireResultDto } from './dto/create-questionnaire-result.dto';

@Controller()
export class QuestionnairesController {
  constructor(private readonly questionnairesService: QuestionnairesService) {}

  @Post('patients/:patientId/questionnaire-results')
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreateQuestionnaireResultDto,
  ) {
    return this.questionnairesService.create(patientId, dto);
  }

  @Get('patients/:patientId/questionnaire-results')
  findByPatient(@Param('patientId') patientId: string) {
    return this.questionnairesService.findByPatient(patientId);
  }

  @Get('questionnaire-results/:id')
  findOne(@Param('id') id: string) {
    return this.questionnairesService.findOne(id);
  }
}
