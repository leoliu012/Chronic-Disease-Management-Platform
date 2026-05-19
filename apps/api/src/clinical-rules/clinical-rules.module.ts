import { Module } from '@nestjs/common';
import { SecurityModule } from '../security/security.module';
import { ClinicalRulesController } from './clinical-rules.controller';
import { ClinicalRulesService } from './clinical-rules.service';

@Module({
  imports: [SecurityModule],
  controllers: [ClinicalRulesController],
  providers: [ClinicalRulesService],
  exports: [ClinicalRulesService],
})
export class ClinicalRulesModule {}
