import { ApiController, Get } from '@meghjs/core';
import { StatsService } from '../services/stats.service';

@ApiController('/stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  summary() {
    return this.stats.summary();
  }
}
