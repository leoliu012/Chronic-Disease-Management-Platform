import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../security/public.decorator';
import { HealthService } from './health.service';

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live() {
    return this.health.live();
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const status = await this.health.ready();
    if (status.status !== 'UP') response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return status;
  }
}
