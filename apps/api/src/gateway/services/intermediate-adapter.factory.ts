/**
 * intermediate-adapter.factory.ts
 *
 * gateway-production-hardening: 根据 env GATEWAY_INTERMEDIATE_ADAPTER 选择
 * Mock / SqlServer / Oracle 三个适配器之一. 不动 IntermediatePollerService —
 * 它仍然通过 INTERMEDIATE_DB_ADAPTER token 注入.
 *
 * 用法 (已在 gateway.module.ts 完成):
 *   {
 *     provide: INTERMEDIATE_DB_ADAPTER,
 *     useFactory: intermediateAdapterFactory,
 *   }
 */

import { Logger } from '@nestjs/common';
import { IntermediateDbAdapter } from '../interfaces/intermediate-db.adapter';
import { MockIntermediateDbAdapter } from './mock-intermediate-db.adapter';
import { OracleIntermediateDbAdapter } from './oracle-intermediate-db.adapter';
import { SqlServerIntermediateDbAdapter } from './sqlserver-intermediate-db.adapter';

const logger = new Logger('IntermediateAdapterFactory');

export function intermediateAdapterFactory(): IntermediateDbAdapter {
  const kind = (process.env.GATEWAY_INTERMEDIATE_ADAPTER ?? 'mock').toLowerCase();
  switch (kind) {
    case 'sqlserver':
    case 'mssql': {
      logger.log('Selecting SqlServerIntermediateDbAdapter.');
      return new SqlServerIntermediateDbAdapter();
    }
    case 'oracle':
    case 'oracledb': {
      logger.log('Selecting OracleIntermediateDbAdapter.');
      return new OracleIntermediateDbAdapter();
    }
    case 'mock':
    case '':
    default: {
      if (kind !== 'mock' && kind !== '') {
        logger.warn(
          `Unknown GATEWAY_INTERMEDIATE_ADAPTER=${kind}, falling back to MockIntermediateDbAdapter.`,
        );
      } else {
        logger.log('Selecting MockIntermediateDbAdapter (dev / demo).');
      }
      return new MockIntermediateDbAdapter();
    }
  }
}
