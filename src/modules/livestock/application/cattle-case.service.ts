import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { CattleOpsAuditAction, CattleOpsAuditEntity } from '../domain/livestock-ops.constants.js';
import {
  rowToCattleCase,
  type CreateCattleCaseInput,
  type ListCattleCasesFilter,
  type CattleCase,
  type CattleCaseSummary,
  type UpdateCattleCaseInput,
} from '../domain/cattle-ops.types.js';
import type { CattleCaseRepository } from '../infrastructure/cattle-case.repository.js';
import type { CattleBatchRepository } from '../infrastructure/cattle-batch.repository.js';

export interface FarmActor {
  actorUserId: string;
  context?: AuditContext;
}

const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_UPLOAD_URL_TTL_SECONDS = 600;
const IMAGE_URL_TTL_SECONDS = 3600;

/** "الحالات الفردية" — individual sick cattle tracked to recovery / death. */
export class CattleCaseService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly cases: CattleCaseRepository,
    private readonly batches: CattleBatchRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'cattle-case-service' });
  }

  private async assertBatch(organizationId: string, batchId: string): Promise<void> {
    const batch = await this.batches.findByIdForOrganization(batchId, organizationId);
    if (!batch) throw new NotFoundError('Cattle batch not found');
  }

  private async resolveImageUrl(key: string | null): Promise<string | null> {
    if (!key) return null;
    return (
      this.storage.getPublicUrl(key) ??
      (await this.storage.getSignedUrl(key, { operation: 'get', expiresIn: IMAGE_URL_TTL_SECONDS }))
    );
  }

  async list(
    organizationId: string,
    batchId: string,
    filter: ListCattleCasesFilter,
  ): Promise<{ items: CattleCase[]; total: number }> {
    await this.assertBatch(organizationId, batchId);
    const { rows, total } = await this.cases.listForBatch(batchId, filter);
    const items = await Promise.all(
      rows.map(async (r) => rowToCattleCase(r, await this.resolveImageUrl(r.image_key))),
    );
    return { items, total };
  }

  async summary(organizationId: string, batchId: string): Promise<CattleCaseSummary> {
    await this.assertBatch(organizationId, batchId);
    const counts = await this.cases.statusCounts(batchId);
    return {
      deceased: counts.DECEASED ?? 0,
      recovered: counts.RECOVERED ?? 0,
      underTreatment: counts.UNDER_TREATMENT ?? 0,
    };
  }

  async get(organizationId: string, batchId: string, caseId: string): Promise<CattleCase> {
    await this.assertBatch(organizationId, batchId);
    const row = await this.cases.findRowByIdForBatch(caseId, batchId);
    if (!row) throw new NotFoundError('Case not found');
    return rowToCattleCase(row, await this.resolveImageUrl(row.image_key));
  }

  async create(
    organizationId: string,
    batchId: string,
    input: CreateCattleCaseInput,
    actor: FarmActor,
  ): Promise<CattleCase> {
    await this.assertBatch(organizationId, batchId);
    const row = await this.db.transaction(async (tx) => {
      const caseNumber = await this.cases.nextCaseNumber(batchId, tx);
      const created = await this.cases.create(
        { ...input, cattleBatchId: batchId, organizationId, caseNumber, createdByUserId: actor.actorUserId },
        tx,
      );
      await this.audit.record(
        {
          action: CattleOpsAuditAction.CATTLE_CASE_CREATED,
          entityType: CattleOpsAuditEntity.CATTLE_CASE,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, cattleBatchId: batchId, caseNumber },
          context: actor.context,
        },
        tx,
      );
      return created;
    });
    this.events.publish('cattle.case.created', { organizationId, cattleBatchId: batchId, caseId: row.id });
    return rowToCattleCase(row, null);
  }

  async update(
    organizationId: string,
    batchId: string,
    caseId: string,
    patch: UpdateCattleCaseInput,
    actor: FarmActor,
  ): Promise<CattleCase> {
    await this.assertBatch(organizationId, batchId);
    const existing = await this.cases.findRowByIdForBatch(caseId, batchId);
    if (!existing) throw new NotFoundError('Case not found');
    const row = await this.db.transaction(async (tx) => {
      const updated = await this.cases.update(caseId, patch, tx);
      await this.audit.record(
        {
          action: CattleOpsAuditAction.CATTLE_CASE_UPDATED,
          entityType: CattleOpsAuditEntity.CATTLE_CASE,
          entityId: caseId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, cattleBatchId: batchId, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return updated;
    });
    return rowToCattleCase(row, await this.resolveImageUrl(row.image_key));
  }

  async delete(organizationId: string, batchId: string, caseId: string, actor: FarmActor): Promise<void> {
    await this.assertBatch(organizationId, batchId);
    const existing = await this.cases.findRowByIdForBatch(caseId, batchId);
    if (!existing) throw new NotFoundError('Case not found');
    await this.db.transaction(async (tx) => {
      await this.cases.deleteById(caseId, tx);
      await this.audit.record(
        {
          action: CattleOpsAuditAction.CATTLE_CASE_DELETED,
          entityType: CattleOpsAuditEntity.CATTLE_CASE,
          entityId: caseId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, cattleBatchId: batchId },
          context: actor.context,
        },
        tx,
      );
    });
    if (existing.image_key) {
      try {
        await this.storage.delete(existing.image_key);
      } catch (err) {
        this.log.error({ err, caseId }, 'failed to delete case image — needs a sweep');
      }
    }
  }

  // --- image (presigned direct-to-storage upload) ------------------

  async requestImageUploadUrl(
    organizationId: string,
    batchId: string,
    caseId: string,
    input: { filename: string; mimeType: string; size: number },
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresInSeconds: number;
  }> {
    await this.assertBatch(organizationId, batchId);
    const existing = await this.cases.findRowByIdForBatch(caseId, batchId);
    if (!existing) throw new NotFoundError('Case not found');
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError(`image exceeds the ${MAX_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_IMAGE_MIME.includes(input.mimeType as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed for a case image`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
    const storageKey = buildObjectKey(StoragePrefix.organizationFiles, input.filename);
    const uploadUrl = await this.storage.getSignedUrl(storageKey, {
      operation: 'put',
      expiresIn: IMAGE_UPLOAD_URL_TTL_SECONDS,
      contentType: input.mimeType,
    });
    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresInSeconds: IMAGE_UPLOAD_URL_TTL_SECONDS,
    };
  }

  async registerImage(
    organizationId: string,
    batchId: string,
    caseId: string,
    actor: FarmActor,
    input: { storageKey: string; mimeType: string },
  ): Promise<CattleCase> {
    await this.assertBatch(organizationId, batchId);
    const existing = await this.cases.findRowByIdForBatch(caseId, batchId);
    if (!existing) throw new NotFoundError('Case not found');
    if (!input.storageKey.startsWith(`${StoragePrefix.organizationFiles}/`)) {
      throw new BadRequestError('storage key does not belong to organization uploads', {
        code: ErrorCode.STORAGE_KEY_MISMATCH,
      });
    }
    const head = await this.storage.head(input.storageKey);
    if (!head) {
      throw new BadRequestError('no uploaded object exists at that storage key', {
        code: ErrorCode.STORAGE_OBJECT_MISSING,
      });
    }
    const realMime = head.contentType ?? input.mimeType;
    if (head.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError('the uploaded object exceeds the size limit', {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_IMAGE_MIME.includes(realMime as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new BadRequestError(`the uploaded object's type "${realMime}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }

    const previousKey = existing.image_key;
    const row = await this.db.transaction(async (tx) => {
      const updated = await this.cases.update(caseId, { imageKey: input.storageKey }, tx);
      await this.audit.record(
        {
          action: CattleOpsAuditAction.CATTLE_CASE_UPDATED,
          entityType: CattleOpsAuditEntity.CATTLE_CASE,
          entityId: caseId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, cattleBatchId: batchId, imageUpdated: true },
          context: actor.context,
        },
        tx,
      );
      return updated;
    });
    if (previousKey && previousKey !== input.storageKey) {
      try {
        await this.storage.delete(previousKey);
      } catch (err) {
        this.log.error({ err, caseId }, 'failed to delete replaced case image — needs a sweep');
      }
    }
    return rowToCattleCase(row, await this.resolveImageUrl(row.image_key));
  }
}
