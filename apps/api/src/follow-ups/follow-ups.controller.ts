import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { FollowUpsService } from './follow-ups.service';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';

@Controller()
export class FollowUpsController {
  constructor(private readonly followUpsService: FollowUpsService) {}

  @Post('patients/:patientId/follow-ups')
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreateFollowUpDto,
  ) {
    return this.followUpsService.create(patientId, dto);
  }

  @Get('patients/:patientId/follow-ups')
  findByPatient(@Param('patientId') patientId: string) {
    return this.followUpsService.findByPatient(patientId);
  }

  @Get('follow-ups/:id')
  findOne(@Param('id') id: string) {
    return this.followUpsService.findOne(id);
  }

  @Delete('follow-ups/:id')
  remove(@Param('id') id: string) {
    return this.followUpsService.remove(id);
  }
}
