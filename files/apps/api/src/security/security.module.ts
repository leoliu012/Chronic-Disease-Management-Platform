import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { ClinicalAccessScopeService } from './clinical-access-scope.service';

@Global()
@Module({
  providers: [AuditService, ClinicalAccessScopeService],
  exports: [AuditService, ClinicalAccessScopeService],
})
export class SecurityModule {}
