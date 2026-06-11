import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { CarePlansService } from './care-plans.service';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class CarePlanRefreshWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('CarePlanRefreshWorker');
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(private readonly carePlans: CarePlansService) {}

  onApplicationBootstrap() {
    if (process.env.CARE_PLAN_REFRESH_WORKER_ENABLED !== 'true') {
      this.logger.log('Care-plan refresh worker disabled.');
      return;
    }
    const intervalMs = Number(process.env.CARE_PLAN_REFRESH_WORKER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    setTimeout(() => this.runOnce().catch((e) => this.logger.error((e as Error).message)), 8_000);
    this.timer = setInterval(() => {
      this.runOnce().catch((e) => this.logger.error((e as Error).message));
    }, intervalMs);
    this.logger.log(`Care-plan refresh worker scheduled every ${intervalMs}ms.`);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce() {
    if (this.inFlight) return { skipped: true };
    this.inFlight = true;
    try {
      return await this.carePlans.refreshActivePlans();
    } finally {
      this.inFlight = false;
    }
  }
}
