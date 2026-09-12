import type { Knex } from 'knex';
import {
  rowToSeekerProfile,
  type CreateVetJobSeekerProfileInput,
  type ModerationFilter,
  type SeekerBrowseFilter,
  type VetJobSeekerProfile,
  type VetJobSeekerProfileRow,
  type VetJobUserSummary,
} from '../domain/vet-job.types.js';

const T = 'vet_job_seeker_profiles';

interface JoinedRow extends VetJobSeekerProfileRow {
  seeker_first_name: string;
  seeker_last_name: string;
}

export interface VetJobSeekerProfileWithUser {
  profile: VetJobSeekerProfile;
  user: VetJobUserSummary;
}

export class VetJobSeekerProfileRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  private joined(trx?: Knex.Transaction): Knex.QueryBuilder {
    return this.conn(trx)(`${T} as p`)
      .join('users as u', 'u.id', 'p.user_id')
      .select('p.*', 'u.first_name as seeker_first_name', 'u.last_name as seeker_last_name');
  }

  private map(row: JoinedRow): VetJobSeekerProfileWithUser {
    return {
      profile: rowToSeekerProfile(row),
      user: { id: row.user_id, firstName: row.seeker_first_name, lastName: row.seeker_last_name },
    };
  }

  async create(
    data: CreateVetJobSeekerProfileInput & { userId: string },
    trx: Knex.Transaction,
  ): Promise<VetJobSeekerProfile> {
    const [row] = (await trx(T)
      .insert({
        user_id: data.userId,
        specialty: data.specialty,
        headline: data.headline ?? null,
        experience_years: data.experienceYears ?? 0,
        governorate: data.governorate,
        district: data.district ?? null,
        qualifications: data.qualifications ?? null,
        skills: JSON.stringify(data.skills ?? []),
        preferred_employment_types: JSON.stringify(data.preferredEmploymentTypes ?? []),
        phone: data.phone,
        email: data.email ?? null,
        cv_storage_key: data.cvStorageKey ?? null,
        photo_storage_key: data.photoStorageKey ?? null,
        status: 'PENDING',
      })
      .returning('*')) as VetJobSeekerProfileRow[];
    if (!row) throw new Error('vet_job_seeker_profile insert returned no row');
    return rowToSeekerProfile(row);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<VetJobSeekerProfile | null> {
    const row = await this.conn(trx)<VetJobSeekerProfileRow>(T).where({ id }).first();
    return row ? rowToSeekerProfile(row) : null;
  }

  async findByUserId(userId: string, trx?: Knex.Transaction): Promise<VetJobSeekerProfile | null> {
    const row = await this.conn(trx)<VetJobSeekerProfileRow>(T).where({ user_id: userId }).first();
    return row ? rowToSeekerProfile(row) : null;
  }

  async findWithUserById(id: string, trx?: Knex.Transaction): Promise<VetJobSeekerProfileWithUser | null> {
    const row = (await this.joined(trx).where('p.id', id).first()) as JoinedRow | undefined;
    return row ? this.map(row) : null;
  }

  async update(
    id: string,
    patch: Partial<{
      specialty: string;
      headline: string | null;
      experienceYears: number;
      governorate: string;
      district: string | null;
      qualifications: string | null;
      skills: string[];
      preferredEmploymentTypes: string[];
      phone: string;
      email: string | null;
      cvStorageKey: string | null;
      photoStorageKey: string | null;
      status: string;
      reviewedByUserId: string | null;
      reviewedAt: Date | null;
      rejectionReason: string | null;
      closedAt: Date | null;
    }>,
    trx: Knex.Transaction,
  ): Promise<VetJobSeekerProfile> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.specialty !== undefined) dbPatch.specialty = patch.specialty;
    if (patch.headline !== undefined) dbPatch.headline = patch.headline;
    if (patch.experienceYears !== undefined) dbPatch.experience_years = patch.experienceYears;
    if (patch.governorate !== undefined) dbPatch.governorate = patch.governorate;
    if (patch.district !== undefined) dbPatch.district = patch.district;
    if (patch.qualifications !== undefined) dbPatch.qualifications = patch.qualifications;
    if (patch.skills !== undefined) dbPatch.skills = JSON.stringify(patch.skills);
    if (patch.preferredEmploymentTypes !== undefined) {
      dbPatch.preferred_employment_types = JSON.stringify(patch.preferredEmploymentTypes);
    }
    if (patch.phone !== undefined) dbPatch.phone = patch.phone;
    if (patch.email !== undefined) dbPatch.email = patch.email;
    if (patch.cvStorageKey !== undefined) dbPatch.cv_storage_key = patch.cvStorageKey;
    if (patch.photoStorageKey !== undefined) dbPatch.photo_storage_key = patch.photoStorageKey;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.reviewedByUserId !== undefined) dbPatch.reviewed_by_user_id = patch.reviewedByUserId;
    if (patch.reviewedAt !== undefined) dbPatch.reviewed_at = patch.reviewedAt;
    if (patch.rejectionReason !== undefined) dbPatch.rejection_reason = patch.rejectionReason;
    if (patch.closedAt !== undefined) dbPatch.closed_at = patch.closedAt;

    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as VetJobSeekerProfileRow[];
    if (!row) throw new Error('vet_job_seeker_profile not found on update');
    return rowToSeekerProfile(row);
  }

  // --- public browse (APPROVED, not closed) ------------------------------

  async listPublic(
    filter: SeekerBrowseFilter,
  ): Promise<{ items: VetJobSeekerProfileWithUser[]; total: number }> {
    const scope = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      qb.where('p.status', 'APPROVED').whereNull('p.closed_at');
      if (filter.specialty) qb.andWhere('p.specialty', filter.specialty);
      if (filter.governorate) qb.andWhere('p.governorate', filter.governorate);
      if (filter.search) {
        const s = `%${filter.search}%`;
        qb.andWhere((w) => {
          w.whereILike('p.specialty', s)
            .orWhereILike('u.first_name', s)
            .orWhereILike('u.last_name', s);
        });
      }
      return qb;
    };
    const countRow = await scope(this.conn()(`${T} as p`).join('users as u', 'u.id', 'p.user_id'))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await scope(this.joined())
      .orderBy('p.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];
    return { items: rows.map((r) => this.map(r)), total };
  }

  async listForModeration(
    filter: ModerationFilter,
  ): Promise<{ items: VetJobSeekerProfileWithUser[]; total: number }> {
    const apply = (qb: Knex.QueryBuilder): Knex.QueryBuilder =>
      qb.andWhere('p.status', filter.status ?? 'PENDING');
    const countRow = await apply(this.conn()(`${T} as p`))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await apply(this.joined())
      .orderBy('p.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];
    return { items: rows.map((r) => this.map(r)), total };
  }
}
