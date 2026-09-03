import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { PoultryOpsAuditAction, PoultryOpsAuditEntity } from '../domain/poultry-ops.constants.js';
import {
  rowToCase,
  type CreatePoultryCaseInput,
  type ListPoultryCasesFilter,
  type PoultryCase,
  type PoultryCaseSummary,
  type UpdatePoultryCaseInput,
} from '../domain/poultry-ops.types.js';
import type { PoultryCaseRepository } from '../infrastructure/poultry-case.repository.js';
import type { PoultryFlockRepository } from '../infrastructure/poultry-flock.repository.js';

export interface FarmActor {
  actorUserId: string;
  context?: AuditContext;
}

const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_UPLOAD_URL_TTL_SECONDS = 600;
const IMAGE_URL_TTL_SECONDS = 3600;

/** "الحالات الفردية" — individual sick birds tracked to recovery / death. */
export class PoultryCaseService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly cases: PoultryCaseRepository,
    private readonly flocks: PoultryFlockRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'poultry-case-service' });
  }

  private async assertFlock(organizationId: string, flockId: string): Promise<void> {
    const flock = await this.flocks.findByIdForOrganization(flockId, organizationId);
    if (!flock) throw new NotFoundError('Poultry flock not found');
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
    flockId: string,
    filter: ListPoultryCasesFilter,
  ): Promise<{ items: PoultryCase[]; total: number }> {
    await this.assertFlock(organizationId, flockId);
    const { rows, total } = await this.cases.listForFlock(flockId, filter);
    const items = await Promise.all(
      rows.map(async (r) => rowToCase(r, await this.resolveImageUrl(r.image_key))),
    );
    return { items, total };
  }

  async summary(organizationId: string, flockId: string): Promise<PoultryCaseSummary> {
    await this.assertFlock(organizationId, flockId);
    const counts = await this.cases.statusCounts(flockId);
    return {
      deceased: counts.DECEASED ?? 0,
      recovered: counts.RECOVERED ?? 0,
      underTreatment: counts.UNDER_TREATMENT ?? 0,
    };
  }

  async get(organizationId: string, flockId: string, caseId: string): Promise<PoultryCase> {
    await this.assertFlock(organizationId, flockId);
    const row = await this.cases.findRowByIdForFlock(caseId, flockId);
    if (!row) throw new NotFoundError('Case not found');
    return rowToCase(row, await this.resolveImageUrl(row.image_key));
  }

  async create(
    organizationId: string,
    flockId: string,
    input: CreatePoultryCaseInput,
    actor: FarmActor,
  ): Promise<PoultryCase> {
    await this.assertFlock(organizationId, flockId);
    const row = await this.db.transaction(async (tx) => {
      const caseNumber = await this.cases.nextCaseNumber(flockId, tx);
      const created = await this.cases.create(
        {
          ...input,
          poultryFlockId: flockId,
          organizationId,
          caseNumber,
          createdByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.POULTRY_CASE_CREATED,
          entityType: PoultryOpsAuditEntity.POULTRY_CASE,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, poultryFlockId: flockId, caseNumber },
          context: actor.context,
        },
        tx,
      );
      return created;
    });
    this.events.publish('poultry.case.created', {
      organizationId,
      poultryFlockId: flockId,
      caseId: row.id,
    });
    return rowToCase(row, null);
  }

  async update(
    organizationId: string,
    flockId: string,
    caseId: string,
    patch: UpdatePoultryCaseInput,
    actor: FarmActor,
  ): Promise<PoultryCase> {
    await this.assertFlock(organizationId, flockId);
    const existing = await this.cases.findRowByIdForFlock(caseId, flockId);
    if (!existing) throw new NotFoundError('Case not found');
    const row = await this.db.transaction(async (tx) => {
      const updated = await this.cases.update(caseId, patch, tx);
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.POULTRY_CASE_UPDATED,
          entityType: PoultryOpsAuditEntity.POULTRY_CASE,
          entityId: caseId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, poultryFlockId: flockId, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return updated;
    });
    return rowToCase(row, await this.resolveImageUrl(row.image_key));
  }

  async delete(
    organizationId: string,
    flockId: string,
    caseId: string,
    actor: FarmActor,
  ): Promise<void> {
    await this.assertFlock(organizationId, flockId);
    const existing = await this.cases.findRowByIdForFlock(caseId, flockId);
    if (!existing) throw new NotFoundError('Case not found');
    await this.db.transaction(async (tx) => {
      await this.cases.deleteById(caseId, tx);
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.POULTRY_CASE_DELETED,
          entityType: PoultryOpsAuditEntity.POULTRY_CASE,
          entityId: caseId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, poultryFlockId: flockId },
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
    flockId: string,
    caseId: string,
    input: { filename: string; mimeType: string; size: number },
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresInSeconds: number;
  }> {
    await this.assertFlock(organizationId, flockId);
    const existing = await this.cases.findRowByIdForFlock(caseId, flockId);
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
    flockId: string,
    caseId: string,
    actor: FarmActor,
    input: { storageKey: string; mimeType: string },
  ): Promise<PoultryCase> {
    await this.assertFlock(organizationId, flockId);
    const existing = await this.cases.findRowByIdForFlock(caseId, flockId);
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
          action: PoultryOpsAuditAction.POULTRY_CASE_UPDATED,
          entityType: PoultryOpsAuditEntity.POULTRY_CASE,
          entityId: caseId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, poultryFlockId: flockId, imageUpdated: true },
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
    return rowToCase(row, await this.resolveImageUrl(row.image_key));
  }
}
