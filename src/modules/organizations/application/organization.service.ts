import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { UserService } from '../../users/user.service.js';
import { OrganizationPolicy } from '../domain/organization.policy.js';
import { OWNER_ORG_ROLE_KEY } from '../domain/organization-rbac.constants.js';
import {
  toPublicOrganizationDTO,
  type Organization,
  type OrganizationStatus,
  type OrganizationType,
  type OrganizationWithDetails,
  type PublicOrganizationDTO,
} from '../domain/organization.types.js';
import type { MembershipRepository } from '../infrastructure/membership.repository.js';
import type { OrganizationRbacRepository } from '../infrastructure/organization-rbac.repository.js';
import type {
  ListOrganizationsFilter,
  OrganizationRepository,
} from '../infrastructure/organization.repository.js';

/** Shared by the logo AND the gallery — both are plain organization photos. */
const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Hard ceiling per image (5 MiB — mirrors the user avatar limit). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_UPLOAD_URL_TTL_SECONDS = 600;
const IMAGE_URL_TTL_SECONDS = 3600;
/** Directory profile photos beyond the logo — the Clinic Details carousel. */
const MAX_GALLERY_IMAGES = 8;

export interface OrgActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface CreateOrganizationInput {
  type: OrganizationType;
  name: string;
  description?: string | null;
}

const NON_ADMIN_STATUS_CHANGE: Record<
  'suspend' | 'activate' | 'deactivate',
  { to: OrganizationStatus; from: OrganizationStatus[]; action: string; event: string }
> = {
  suspend: {
    to: 'SUSPENDED',
    from: ['ACTIVE', 'SUSPENDED'],
    action: AuditAction.ORGANIZATION_SUSPENDED,
    event: 'organization.suspended',
  },
  activate: {
    to: 'ACTIVE',
    from: ['SUSPENDED', 'DEACTIVATED', 'ACTIVE'],
    action: AuditAction.ORGANIZATION_ACTIVATED,
    event: 'organization.activated',
  },
  deactivate: {
    to: 'DEACTIVATED',
    from: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'],
    action: AuditAction.ORGANIZATION_DEACTIVATED,
    event: 'organization.deactivated',
  },
};

/**
 * Common organization lifecycle: creation (→ PENDING), admin approval/rejection,
 * admin status changes, and reads. Type-specific rules live in
 * {@link OrganizationPolicy} — never inlined here.
 */
export class OrganizationService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly orgRbac: OrganizationRbacRepository,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly storage: ObjectStorage,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'organization-service' });
  }

  private async resolveLogoUrl(key: string | null): Promise<string | null> {
    if (!key) return null;
    return (
      this.storage.getPublicUrl(key) ??
      (await this.storage.getSignedUrl(key, { operation: 'get', expiresIn: IMAGE_URL_TTL_SECONDS }))
    );
  }

  private async resolveGalleryUrls(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const urls = await Promise.all(keys.map((key) => this.resolveLogoUrl(key)));
    return urls.filter((u): u is string => u !== null);
  }

  /**
   * `findByIdWithDetails` fills address/coordinates/phone but deliberately
   * leaves `logoUrl` / `galleryUrls` unset — resolving storage keys to URLs is
   * an application concern, not the repository's. This attaches them (a
   * second, cheap profile-row read; detail reads aren't a hot path).
   */
  private async attachMedia(
    withDetails: OrganizationWithDetails,
  ): Promise<OrganizationWithDetails> {
    if (!OrganizationPolicy.hasProfileFields(withDetails.type)) return withDetails;
    const row = await this.organizations.findProfileRow(withDetails.type, withDetails.id);
    const [logoUrl, galleryUrls] = await Promise.all([
      this.resolveLogoUrl(row?.logo_key ?? null),
      this.resolveGalleryUrls(row?.gallery_keys ?? []),
    ]);
    return { ...withDetails, details: { ...withDetails.details, logoUrl, galleryUrls } };
  }

  async create(input: CreateOrganizationInput, actor: OrgActor): Promise<OrganizationWithDetails> {
    const creator = await this.users.getById(actor.actorUserId);
    OrganizationPolicy.assertCanCreate(input.type, creator);
    OrganizationPolicy.validateTypeSpecificRules(input.type, input);

    const org = await this.db.transaction(async (tx) => {
      const ownerRole = await this.orgRbac.findRoleByKey(OWNER_ORG_ROLE_KEY, tx);
      if (!ownerRole) throw new InternalError('Seed data missing: organization role "OWNER"');

      const created = await this.organizations.create(
        {
          type: input.type,
          name: input.name,
          description: input.description ?? null,
          ownerUserId: actor.actorUserId,
        },
        tx,
      );

      const detailExtra = OrganizationPolicy.hasJoinCode(input.type)
        ? { join_code: OrganizationPolicy.generateJoinCode() }
        : {};
      await this.organizations.insertDetails(input.type, created.id, detailExtra, tx);

      const membership = await this.memberships.create(
        {
          organizationId: created.id,
          userId: actor.actorUserId,
          organizationRoleId: ownerRole.id,
          status: 'ACTIVE',
          addedBy: actor.actorUserId,
        },
        tx,
      );

      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_CREATED,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { type: created.type, name: created.name },
          context: actor.context,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_MEMBER_ADDED,
          entityType: AuditEntityType.ORGANIZATION_MEMBERSHIP,
          entityId: membership.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId: created.id, userId: actor.actorUserId, roleKey: 'OWNER' },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('organization.created', {
      organizationId: org.id,
      type: org.type,
      ownerUserId: org.ownerUserId,
    });

    const withDetails = await this.organizations.findByIdWithDetails(org.id);
    if (!withDetails) throw new InternalError('organization vanished after creation');
    return this.attachMedia(withDetails);
  }

  async getWithDetails(id: string): Promise<OrganizationWithDetails | null> {
    const withDetails = await this.organizations.findByIdWithDetails(id);
    return withDetails ? this.attachMedia(withDetails) : null;
  }

  async updateProfile(
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      address?: string | null;
      phone?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      workingHours?: string | null;
      services?: string[] | null;
      email?: string | null;
      whatsapp?: string | null;
      instagramUrl?: string | null;
      facebookUrl?: string | null;
      tiktokUrl?: string | null;
    },
    actor: OrgActor,
  ): Promise<OrganizationWithDetails> {
    const profileFieldKeys = (
      [
        'address',
        'phone',
        'latitude',
        'longitude',
        'workingHours',
        'services',
        'email',
        'whatsapp',
        'instagramUrl',
        'facebookUrl',
        'tiktokUrl',
      ] as const
    ).filter((k) => patch[k] !== undefined);
    const org = await this.getById(id);
    if (profileFieldKeys.length > 0) OrganizationPolicy.assertHasProfileFields(org.type);

    await this.db.transaction(async (tx) => {
      await this.organizations.update(id, { name: patch.name, description: patch.description }, tx);
      if (profileFieldKeys.length > 0) {
        await this.organizations.updateProfileFields(
          org.type,
          id,
          {
            address: patch.address,
            phone: patch.phone,
            latitude: patch.latitude,
            longitude: patch.longitude,
            workingHours: patch.workingHours,
            services: patch.services,
            email: patch.email,
            whatsapp: patch.whatsapp,
            instagramUrl: patch.instagramUrl,
            facebookUrl: patch.facebookUrl,
            tiktokUrl: patch.tiktokUrl,
          },
          tx,
        );
      }
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_UPDATED,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
    });
    const withDetails = await this.organizations.findByIdWithDetails(id);
    if (!withDetails) throw new InternalError('organization vanished after update');
    return this.attachMedia(withDetails);
  }

  async getById(id: string): Promise<Organization> {
    const org = await this.organizations.findById(id);
    if (!org) throw new NotFoundError('Organization not found');
    return org;
  }

  listForAdmin(filter: ListOrganizationsFilter): Promise<{ items: Organization[]; total: number }> {
    return this.organizations.list(filter);
  }

  listPendingForAdmin(
    page: number,
    pageSize: number,
  ): Promise<{ items: Organization[]; total: number }> {
    return this.organizations.list({ page, pageSize, status: 'PENDING' });
  }

  /**
   * Public discovery — any authenticated user, not just members (e.g. the Pet
   * Owner Home "Available clinics" section / `DiscoverClinicsScreen`). ACTIVE
   * organizations only; the narrower {@link PublicOrganizationDTO} omits
   * owner/decision metadata.
   *
   * When `type` has a directory profile (CLINIC / VETERINARY_OFFICE /
   * VETERINARY_STORE), the listing is joined with that profile (address,
   * coordinates, phone, logo) and, if `near` is given, ordered by distance —
   * see `OrganizationRepository.discoverWithDetails`. Any other `type`
   * (including FARM, or no type at all) falls back to the plain listing with
   * empty profile fields; `near` is ignored there since there is nothing to
   * measure distance from.
   */
  async discoverPublic(filter: {
    page: number;
    pageSize: number;
    type?: OrganizationType;
    search?: string;
    near?: { lat: number; lng: number };
  }): Promise<{ items: PublicOrganizationDTO[]; total: number }> {
    if (filter.type && OrganizationPolicy.hasProfileFields(filter.type)) {
      const { items, total } = await this.organizations.discoverWithDetails({
        type: filter.type,
        search: filter.search,
        near: filter.near,
        page: filter.page,
        pageSize: filter.pageSize,
      });
      const dtos = await Promise.all(
        items.map(async (item) => {
          const { logoKey, ...profile } = item.profile;
          const logoUrl = await this.resolveLogoUrl(logoKey);
          return toPublicOrganizationDTO(
            item.organization,
            { ...profile, logoUrl },
            item.distanceKm,
          );
        }),
      );
      return { items: dtos, total };
    }

    const { items, total } = await this.organizations.list({
      page: filter.page,
      pageSize: filter.pageSize,
      type: filter.type,
      search: filter.search,
      status: 'ACTIVE',
    });
    return { items: items.map((org) => toPublicOrganizationDTO(org)), total };
  }

  /** Single-organization counterpart of {@link discoverPublic} — ACTIVE only. */
  async getPublicById(id: string): Promise<PublicOrganizationDTO> {
    const org = await this.organizations.findById(id);
    if (!org || org.status !== 'ACTIVE') throw new NotFoundError('Organization not found');
    if (!OrganizationPolicy.hasProfileFields(org.type)) return toPublicOrganizationDTO(org);

    const row = await this.organizations.findProfileRow(org.type, id);
    const [logoUrl, galleryUrls] = await Promise.all([
      this.resolveLogoUrl(row?.logo_key ?? null),
      this.resolveGalleryUrls(row?.gallery_keys ?? []),
    ]);
    return toPublicOrganizationDTO(org, {
      address: row?.address ?? null,
      latitude: row?.latitude ?? null,
      longitude: row?.longitude ?? null,
      phone: row?.phone ?? null,
      logoUrl,
      workingHours: row?.working_hours ?? null,
      services: row?.services ?? [],
      email: row?.email ?? null,
      whatsapp: row?.whatsapp ?? null,
      instagramUrl: row?.instagram_url ?? null,
      facebookUrl: row?.facebook_url ?? null,
      tiktokUrl: row?.tiktok_url ?? null,
      galleryUrls,
    });
  }

  // --- logo (presigned direct-to-storage upload) --------------------

  async requestLogoUploadUrl(
    organizationId: string,
    input: { filename: string; mimeType: string; size: number },
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresInSeconds: number;
  }> {
    const org = await this.getById(organizationId);
    OrganizationPolicy.assertHasProfileFields(org.type);

    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError(`logo exceeds the ${MAX_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_IMAGE_MIME.includes(input.mimeType as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed for a logo`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }

    // The server ALWAYS generates the key — the client never controls it.
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

  async finalizeLogo(
    organizationId: string,
    actor: OrgActor,
    input: { storageKey: string; mimeType: string },
  ): Promise<OrganizationWithDetails> {
    const org = await this.getById(organizationId);
    OrganizationPolicy.assertHasProfileFields(org.type);
    if (!input.storageKey.startsWith(`${StoragePrefix.organizationFiles}/`)) {
      throw new ConflictError('storage key does not belong to organization uploads', {
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

    const previousRow = await this.organizations.findProfileRow(org.type, organizationId);
    const previousKey = previousRow?.logo_key ?? null;

    await this.db.transaction(async (tx) => {
      await this.organizations.updateProfileFields(
        org.type,
        organizationId,
        { logoKey: input.storageKey },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_LOGO_UPDATED,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: organizationId,
          actorUserId: actor.actorUserId,
          // NB: no storage key / URL / credentials in audit metadata.
          metadata: { organizationId, sizeBytes: head.size },
          context: actor.context,
        },
        tx,
      );
    });

    // Best-effort cleanup of the replaced object AFTER commit (§28 pattern).
    if (previousKey && previousKey !== input.storageKey) {
      try {
        await this.storage.delete(previousKey);
      } catch (err) {
        this.log.error(
          { err, organizationId },
          'failed to delete replaced organization logo — needs a sweep',
        );
      }
    }

    const withDetails = await this.organizations.findByIdWithDetails(organizationId);
    if (!withDetails) throw new InternalError('organization vanished after logo update');
    return this.attachMedia(withDetails);
  }

  // --- gallery (presigned direct-to-storage upload, N photos) -------

  /** Same validation/URL shape as {@link requestLogoUploadUrl} — one photo at a time. */
  async requestGalleryUploadUrl(
    organizationId: string,
    input: { filename: string; mimeType: string; size: number },
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresInSeconds: number;
  }> {
    const org = await this.getById(organizationId);
    OrganizationPolicy.assertHasProfileFields(org.type);

    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError(`photo exceeds the ${MAX_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_IMAGE_MIME.includes(input.mimeType as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed for a photo`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }

    const row = await this.organizations.findProfileRow(org.type, organizationId);
    if ((row?.gallery_keys?.length ?? 0) >= MAX_GALLERY_IMAGES) {
      throw new BadRequestError(
        `the gallery already has the maximum of ${MAX_GALLERY_IMAGES} photos`,
        {
          code: ErrorCode.GALLERY_LIMIT_EXCEEDED,
        },
      );
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

  /** Registers an uploaded gallery photo — appends to the existing array. */
  async addGalleryImage(
    organizationId: string,
    actor: OrgActor,
    input: { storageKey: string; mimeType: string },
  ): Promise<OrganizationWithDetails> {
    const org = await this.getById(organizationId);
    OrganizationPolicy.assertHasProfileFields(org.type);
    if (!input.storageKey.startsWith(`${StoragePrefix.organizationFiles}/`)) {
      throw new ConflictError('storage key does not belong to organization uploads', {
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

    const row = await this.organizations.findProfileRow(org.type, organizationId);
    const currentKeys = row?.gallery_keys ?? [];
    if (currentKeys.length >= MAX_GALLERY_IMAGES) {
      throw new BadRequestError(
        `the gallery already has the maximum of ${MAX_GALLERY_IMAGES} photos`,
        {
          code: ErrorCode.GALLERY_LIMIT_EXCEEDED,
        },
      );
    }
    const galleryKeys = [...currentKeys, input.storageKey];

    await this.db.transaction(async (tx) => {
      await this.organizations.updateProfileFields(org.type, organizationId, { galleryKeys }, tx);
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_GALLERY_UPDATED,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: organizationId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, sizeBytes: head.size, photoCount: galleryKeys.length },
          context: actor.context,
        },
        tx,
      );
    });

    const withDetails = await this.organizations.findByIdWithDetails(organizationId);
    if (!withDetails) throw new InternalError('organization vanished after gallery update');
    return this.attachMedia(withDetails);
  }

  /** Removes one gallery photo by storage key. */
  async removeGalleryImage(
    organizationId: string,
    actor: OrgActor,
    storageKey: string,
  ): Promise<OrganizationWithDetails> {
    const org = await this.getById(organizationId);
    OrganizationPolicy.assertHasProfileFields(org.type);

    const row = await this.organizations.findProfileRow(org.type, organizationId);
    const currentKeys = row?.gallery_keys ?? [];
    const galleryKeys = currentKeys.filter((k) => k !== storageKey);
    if (galleryKeys.length === currentKeys.length) {
      throw new NotFoundError('Gallery photo not found');
    }

    await this.db.transaction(async (tx) => {
      await this.organizations.updateProfileFields(org.type, organizationId, { galleryKeys }, tx);
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_GALLERY_UPDATED,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: organizationId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, photoCount: galleryKeys.length },
          context: actor.context,
        },
        tx,
      );
    });

    try {
      await this.storage.delete(storageKey);
    } catch (err) {
      this.log.error(
        { err, organizationId },
        'failed to delete removed gallery photo — needs a sweep',
      );
    }

    const withDetails = await this.organizations.findByIdWithDetails(organizationId);
    if (!withDetails) throw new InternalError('organization vanished after gallery update');
    return this.attachMedia(withDetails);
  }

  /** Organizations the user is an ACTIVE member of, with their org role in each. */
  async listMine(userId: string): Promise<Array<Organization & { myRole: string }>> {
    const memberships = await this.memberships.listActiveOrganizationsForUser(userId);
    if (memberships.length === 0) return [];
    const roleByOrg = new Map(memberships.map((m) => [m.organizationId, m.roleKey]));
    const orgs = await this.organizations.findManyByIds([...roleByOrg.keys()]);
    return orgs.map((o) => ({ ...o, myRole: roleByOrg.get(o.id) ?? 'STAFF' }));
  }

  async approve(id: string, actor: OrgActor): Promise<Organization> {
    const org = await this.getById(id);
    if (org.status !== 'PENDING') {
      throw new ConflictError('Only a pending organization can be approved');
    }
    const updated = await this.db.transaction(async (tx) => {
      const u = await this.organizations.updateStatus(
        id,
        { status: 'ACTIVE', decidedBy: actor.actorUserId, decisionReason: null },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_APPROVED,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { type: org.type },
          context: actor.context,
        },
        tx,
      );
      return u;
    });
    this.events.publish('organization.approved', {
      organizationId: id,
      ownerUserId: org.ownerUserId,
    });
    return updated;
  }

  async reject(id: string, reason: string, actor: OrgActor): Promise<Organization> {
    const org = await this.getById(id);
    if (org.status !== 'PENDING') {
      throw new ConflictError('Only a pending organization can be rejected');
    }
    const updated = await this.db.transaction(async (tx) => {
      const u = await this.organizations.updateStatus(
        id,
        { status: 'REJECTED', decidedBy: actor.actorUserId, decisionReason: reason },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_REJECTED,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { type: org.type, reason },
          context: actor.context,
        },
        tx,
      );
      return u;
    });
    this.events.publish('organization.rejected', {
      organizationId: id,
      ownerUserId: org.ownerUserId,
    });
    return updated;
  }

  async changeStatus(
    id: string,
    op: 'suspend' | 'activate' | 'deactivate',
    actor: OrgActor,
    reason?: string,
  ): Promise<Organization> {
    const org = await this.getById(id);
    if (org.status === 'PENDING' || org.status === 'REJECTED') {
      throw new ConflictError(
        'Use approve/reject for a pending organization; status changes apply to reviewed organizations only',
      );
    }
    const rule = NON_ADMIN_STATUS_CHANGE[op];
    if (!rule.from.includes(org.status)) {
      throw new ConflictError(`Cannot ${op} an organization in status ${org.status}`);
    }

    const updated = await this.db.transaction(async (tx) => {
      const u = await this.organizations.updateStatus(id, { status: rule.to }, tx);
      await this.audit.record(
        {
          action: rule.action,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { from: org.status, to: rule.to, reason: reason ?? null },
          context: actor.context,
        },
        tx,
      );
      return u;
    });
    this.events.publish(rule.event, { organizationId: id, ownerUserId: org.ownerUserId });
    return updated;
  }
}
