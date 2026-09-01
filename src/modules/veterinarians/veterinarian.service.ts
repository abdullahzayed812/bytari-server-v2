import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
} from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import type { EventBus } from '../../shared/events/index.js';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../infra/storage/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../audit/audit.types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { RoleRepository } from '../rbac/role.repository.js';
import type { UserService } from '../users/user.service.js';
import type {
  CreateVeterinarianApplicationDocumentData,
  VeterinarianDocumentRepository,
} from './veterinarian-document.repository.js';
import type {
  PendingApplicationRecord,
  VeterinarianApplicationRecord,
  VeterinarianRepository,
} from './veterinarian.repository.js';
import { VeterinarianPolicy } from './veterinarian.policy.js';
import {
  toApplicantDocumentDTO,
  type AdminVeterinarianApplicationDocument,
  type PendingApplicationSummary,
  type VetApplicationDocumentKind,
  type VetApplicationSubType,
  type VeterinarianApplication,
} from './veterinarian.types.js';

export interface VetActor {
  actorUserId: string;
  context?: AuditContext;
}

const DOCUMENT_UPLOAD_URL_TTL_SECONDS = 600;
const DOCUMENT_DOWNLOAD_URL_TTL_SECONDS = 300;

interface ApplyDocumentInput {
  kind: VetApplicationDocumentKind;
  storageKey: string;
  filename: string;
  mimeType: string;
}

/**
 * Veterinarian approval workflow.
 *
 *   apply → PENDING → (admin) approve → APPROVED  (+ VETERINARIAN role granted)
 *                   → (admin) reject  → REJECTED  (may re-apply)
 *
 * `users.veterinarian_status` is kept in sync inside the same transaction as the
 * application row. Veterinarian-only authorization is gated separately by
 * `AuthorizationService` (status must be APPROVED).
 *
 * Applications optionally carry identity documents (license/ID for a
 * VETERINARIAN application, both sides of a student ID for a STUDENT one),
 * uploaded via the same presigned direct-to-storage pattern as the content
 * module: request a URL → PUT bytes → submit the application referencing the
 * storage key. `storage.head()` (I/O) always runs BEFORE the transaction opens.
 */
export class VeterinarianService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly applications: VeterinarianRepository,
    private readonly documents: VeterinarianDocumentRepository,
    private readonly users: UserService,
    private readonly roles: RoleRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'veterinarian-service' });
  }

  // --- documents -----------------------------------------------

  async requestDocumentUploadUrl(
    userId: string,
    input: { kind: VetApplicationDocumentKind; filename: string; mimeType: string; size: number },
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresInSeconds: number;
  }> {
    await this.users.getById(userId);
    VeterinarianPolicy.assertDocumentUploadRequest(input.kind, input.mimeType, input.size);

    // The server ALWAYS generates the key — the client never controls it.
    const storageKey = buildObjectKey(StoragePrefix.veterinarianDocuments, input.filename);
    const uploadUrl = await this.storage.getSignedUrl(storageKey, {
      operation: 'put',
      expiresIn: DOCUMENT_UPLOAD_URL_TTL_SECONDS,
      contentType: input.mimeType,
    });

    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresInSeconds: DOCUMENT_UPLOAD_URL_TTL_SECONDS,
    };
  }

  // --- apply / status ------------------------------------------

  async apply(
    userId: string,
    input: { note?: string | null; subType: VetApplicationSubType; documents: ApplyDocumentInput[] },
    ctx: AuditContext,
  ): Promise<VeterinarianApplication> {
    const user = await this.users.getById(userId);
    if (user.veterinarianStatus === 'PENDING') {
      throw new ConflictError('A veterinarian application is already pending');
    }
    if (user.veterinarianStatus === 'APPROVED') {
      throw new ConflictError('This account is already an approved veterinarian');
    }

    // Storage I/O ALWAYS happens before the transaction opens.
    const validatedDocuments: Array<
      ApplyDocumentInput & { mimeType: string; sizeBytes: number }
    > = [];
    for (const doc of input.documents) {
      VeterinarianPolicy.assertKeyBelongsToPrefix(doc.storageKey, StoragePrefix.veterinarianDocuments);
      const head = await this.storage.head(doc.storageKey);
      if (!head) {
        throw new BadRequestError('no uploaded object exists at that storage key', {
          code: ErrorCode.STORAGE_OBJECT_MISSING,
        });
      }
      const realMime = head.contentType ?? doc.mimeType;
      VeterinarianPolicy.assertRegisteredDocument(doc.kind, realMime, head.size);
      validatedDocuments.push({ ...doc, mimeType: realMime, sizeBytes: head.size });
    }

    const application = await this.db.transaction(async (tx) => {
      const created = await this.applications.create(
        { userId, note: input.note ?? null, subType: input.subType },
        tx,
      );
      for (const doc of validatedDocuments) {
        const data: CreateVeterinarianApplicationDocumentData = {
          applicationId: created.id,
          kind: doc.kind,
          storageKey: doc.storageKey,
          storageProvider: this.storage.name,
          originalFilename: doc.filename,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          uploadedByUserId: userId,
        };
        await this.documents.create(data, tx);
      }
      await this.users.applyVeterinarianStatus(userId, 'PENDING', tx);
      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_APPLICATION_CREATED,
          entityType: AuditEntityType.VETERINARIAN_APPLICATION,
          entityId: created.id,
          actorUserId: userId,
          metadata: {
            userId,
            subType: input.subType,
            documentKinds: validatedDocuments.map((d) => d.kind),
          },
          context: ctx,
        },
        tx,
      );
      return created;
    });

    this.events.publish('veterinarian.application.submitted', {
      userId,
      applicationId: application.id,
      subType: application.subType,
    });

    const docs = await this.documents.listForApplication(application.id);
    return { ...application, documents: docs.map(toApplicantDocumentDTO) };
  }

  async getStatus(userId: string): Promise<{
    veterinarianStatus: string;
    application: VeterinarianApplication | null;
  }> {
    const user = await this.users.getById(userId);
    const application = await this.applications.findLatestByUser(userId);
    if (!application) return { veterinarianStatus: user.veterinarianStatus, application: null };
    const docs = await this.documents.listForApplication(application.id);
    return {
      veterinarianStatus: user.veterinarianStatus,
      application: { ...application, documents: docs.map(toApplicantDocumentDTO) },
    };
  }

  async listPending(
    page: number,
    pageSize: number,
  ): Promise<{ items: PendingApplicationSummary[]; total: number }> {
    const { items, total } = await this.applications.listPending(page, pageSize);
    const docMap = await this.documents.listForApplications(items.map((a) => a.id));

    const withDocs: PendingApplicationSummary[] = await Promise.all(
      items.map(async (item) => {
        const docs = docMap.get(item.id) ?? [];
        const documents: AdminVeterinarianApplicationDocument[] = await Promise.all(
          docs.map(async (d) => ({
            ...toApplicantDocumentDTO(d),
            downloadUrl: await this.storage.getSignedUrl(d.storageKey, {
              operation: 'get',
              expiresIn: DOCUMENT_DOWNLOAD_URL_TTL_SECONDS,
            }),
          })),
        );
        return { ...item, documents };
      }),
    );

    return { items: withDocs, total };
  }

  private async decoratedApplication(
    application: VeterinarianApplicationRecord | PendingApplicationRecord,
  ): Promise<VeterinarianApplication> {
    const docs = await this.documents.listForApplication(application.id);
    return { ...application, documents: docs.map(toApplicantDocumentDTO) };
  }

  async approve(targetUserId: string, actor: VetActor): Promise<VeterinarianApplication> {
    if (targetUserId === actor.actorUserId) {
      throw new ForbiddenError('You cannot approve your own veterinarian application');
    }

    const decided = await this.db.transaction(async (tx) => {
      const pending = await this.applications.findPendingByUser(targetUserId, tx);
      if (!pending) throw new NotFoundError('No pending veterinarian application for this user');

      const application = await this.applications.decide(
        pending.id,
        { status: 'APPROVED', decidedBy: actor.actorUserId },
        tx,
      );
      await this.users.applyVeterinarianStatus(targetUserId, 'APPROVED', tx);

      const vetRole = await this.roles.findByKey('VETERINARIAN', tx);
      if (!vetRole) throw new InternalError('Seed data missing: role "VETERINARIAN"');
      const roleAdded = await this.roles.assignRole(
        targetUserId,
        vetRole.id,
        actor.actorUserId,
        tx,
      );

      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_APPROVED,
          entityType: AuditEntityType.VETERINARIAN_APPLICATION,
          entityId: application.id,
          actorUserId: actor.actorUserId,
          metadata: { targetUserId, roleGranted: roleAdded },
          context: actor.context,
        },
        tx,
      );
      if (roleAdded) {
        await this.audit.record(
          {
            action: AuditAction.ROLE_ASSIGNED,
            entityType: AuditEntityType.USER_ROLE,
            entityId: targetUserId,
            actorUserId: actor.actorUserId,
            metadata: { roleKey: 'VETERINARIAN', reason: 'veterinarian approval' },
            context: actor.context,
          },
          tx,
        );
      }
      return application;
    });

    this.events.publish('veterinarian.approved', {
      userId: targetUserId,
      applicationId: decided.id,
    });
    return this.decoratedApplication(decided);
  }

  async reject(
    targetUserId: string,
    reason: string,
    actor: VetActor,
  ): Promise<VeterinarianApplication> {
    if (targetUserId === actor.actorUserId) {
      throw new ForbiddenError('You cannot reject your own veterinarian application');
    }

    const decided = await this.db.transaction(async (tx) => {
      const pending = await this.applications.findPendingByUser(targetUserId, tx);
      if (!pending) throw new NotFoundError('No pending veterinarian application for this user');

      const application = await this.applications.decide(
        pending.id,
        { status: 'REJECTED', decidedBy: actor.actorUserId, decisionReason: reason },
        tx,
      );
      await this.users.applyVeterinarianStatus(targetUserId, 'REJECTED', tx);
      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_REJECTED,
          entityType: AuditEntityType.VETERINARIAN_APPLICATION,
          entityId: application.id,
          actorUserId: actor.actorUserId,
          metadata: { targetUserId, reason },
          context: actor.context,
        },
        tx,
      );
      return application;
    });

    this.events.publish('veterinarian.rejected', {
      userId: targetUserId,
      applicationId: decided.id,
    });
    return this.decoratedApplication(decided);
  }
}
