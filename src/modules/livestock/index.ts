/**
 * Sheep Farms & Cattle Farms — closely mirrors `server/src/modules/farms/`'s
 * poultry-flock lifecycle for two additional livestock species. Reuses the
 * generic Phase 3 organization/membership/RBAC/subscription machinery and the
 * poultry module's `farm/profile|expenses|appointments|subscription*` routes
 * unchanged — only the species-specific "batch" entity (and its daily
 * records/health events/individual cases) is genuinely new.
 */
export { createSheepBatchRouter } from './presentation/sheep-batch.routes.js';
export { createCattleBatchRouter } from './presentation/cattle-batch.routes.js';

export { SheepBatchRepository } from './infrastructure/sheep-batch.repository.js';
export { SheepDailyRecordRepository } from './infrastructure/sheep-daily-record.repository.js';
export { SheepHealthEventRepository } from './infrastructure/sheep-health-event.repository.js';
export { SheepCaseRepository } from './infrastructure/sheep-case.repository.js';
export { CattleBatchRepository } from './infrastructure/cattle-batch.repository.js';
export { CattleDailyRecordRepository } from './infrastructure/cattle-daily-record.repository.js';
export { CattleHealthEventRepository } from './infrastructure/cattle-health-event.repository.js';
export { CattleCaseRepository } from './infrastructure/cattle-case.repository.js';

export { SheepBatchService } from './application/sheep-batch.service.js';
export { SheepDailyRecordService } from './application/sheep-daily-record.service.js';
export { SheepHealthEventService } from './application/sheep-health-event.service.js';
export { SheepCaseService } from './application/sheep-case.service.js';
export { CattleBatchService } from './application/cattle-batch.service.js';
export { CattleDailyRecordService } from './application/cattle-daily-record.service.js';
export { CattleHealthEventService } from './application/cattle-health-event.service.js';
export { CattleCaseService } from './application/cattle-case.service.js';

export * from './domain/sheep-batch.constants.js';
export * from './domain/sheep-batch.types.js';
export * from './domain/cattle-batch.constants.js';
export * from './domain/cattle-batch.types.js';
export * from './domain/livestock-ops.constants.js';
export * from './domain/sheep-ops.types.js';
export * from './domain/cattle-ops.types.js';
