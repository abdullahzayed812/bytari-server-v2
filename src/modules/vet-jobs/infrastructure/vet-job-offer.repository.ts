import type { Knex } from 'knex';
import {
  rowToOffer,
  type CreateVetJobOfferInput,
  type ModerationFilter,
  type MineFilter,
  type OfferBrowseFilter,
  type VetJobOffer,
  type VetJobOfferRow,
  type VetJobUserSummary,
} from '../domain/vet-job.types.js';

const T = 'vet_job_offers';

interface JoinedRow extends VetJobOfferRow {
  poster_first_name: string;
  poster_last_name: string;
}

export interface VetJobOfferWithPoster {
  offer: VetJobOffer;
  postedBy: VetJobUserSummary;
  applicationCount?: number;
}

export class VetJobOfferRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  private joined(trx?: Knex.Transaction): Knex.QueryBuilder {
    return this.conn(trx)(`${T} as o`)
      .join('users as u', 'u.id', 'o.posted_by_user_id')
      .select('o.*', 'u.first_name as poster_first_name', 'u.last_name as poster_last_name');
  }

  private map(row: JoinedRow): VetJobOfferWithPoster {
    return {
      offer: rowToOffer(row),
      postedBy: {
        id: row.posted_by_user_id,
        firstName: row.poster_first_name,
        lastName: row.poster_last_name,
      },
    };
  }

  async create(
    data: CreateVetJobOfferInput & { postedByUserId: string },
    trx: Knex.Transaction,
  ): Promise<VetJobOffer> {
    const [row] = (await trx(T)
      .insert({
        posted_by_user_id: data.postedByUserId,
        organization_id: data.organizationId ?? null,
        organization_name: data.organizationName,
        title: data.title,
        employment_type: data.employmentType,
        governorate: data.governorate,
        district: data.district ?? null,
        salary_amount: data.salaryAmount ?? null,
        salary_negotiable: data.salaryNegotiable ?? false,
        experience_years_required: data.experienceYearsRequired ?? null,
        qualifications: data.qualifications ?? null,
        description: data.description,
        responsibilities: JSON.stringify(data.responsibilities ?? []),
        requirements: JSON.stringify(data.requirements ?? []),
        benefits: JSON.stringify(data.benefits ?? []),
        contact_phone: data.contactPhone,
        contact_email: data.contactEmail ?? null,
        application_deadline: data.applicationDeadline ?? null,
        status: 'PENDING',
      })
      .returning('*')) as VetJobOfferRow[];
    if (!row) throw new Error('vet_job_offer insert returned no row');
    return rowToOffer(row);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<VetJobOffer | null> {
    const row = await this.conn(trx)<VetJobOfferRow>(T).where({ id }).first();
    return row ? rowToOffer(row) : null;
  }

  async findWithPosterById(id: string, trx?: Knex.Transaction): Promise<VetJobOfferWithPoster | null> {
    const row = (await this.joined(trx).where('o.id', id).first()) as JoinedRow | undefined;
    return row ? this.map(row) : null;
  }

  /** Same as `findWithPosterById` but also counts applications (owner/moderator view). */
  async findWithPosterAndCountById(
    id: string,
    trx?: Knex.Transaction,
  ): Promise<VetJobOfferWithPoster | null> {
    const row = (await this.joined(trx).where('o.id', id).first()) as JoinedRow | undefined;
    if (!row) return null;
    const counts = await this.applicationCounts([id]);
    return { ...this.map(row), applicationCount: counts.get(id) ?? 0 };
  }

  async update(
    id: string,
    patch: Partial<{
      organizationId: string | null;
      organizationName: string;
      title: string;
      employmentType: string;
      governorate: string;
      district: string | null;
      salaryAmount: string | null;
      salaryNegotiable: boolean;
      experienceYearsRequired: number | null;
      qualifications: string | null;
      description: string;
      responsibilities: string[];
      requirements: string[];
      benefits: string[];
      contactPhone: string;
      contactEmail: string | null;
      applicationDeadline: string | null;
      status: string;
      reviewedByUserId: string | null;
      reviewedAt: Date | null;
      rejectionReason: string | null;
      closedAt: Date | null;
    }>,
    trx: Knex.Transaction,
  ): Promise<VetJobOffer> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.organizationId !== undefined) dbPatch.organization_id = patch.organizationId;
    if (patch.organizationName !== undefined) dbPatch.organization_name = patch.organizationName;
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.employmentType !== undefined) dbPatch.employment_type = patch.employmentType;
    if (patch.governorate !== undefined) dbPatch.governorate = patch.governorate;
    if (patch.district !== undefined) dbPatch.district = patch.district;
    if (patch.salaryAmount !== undefined) dbPatch.salary_amount = patch.salaryAmount;
    if (patch.salaryNegotiable !== undefined) dbPatch.salary_negotiable = patch.salaryNegotiable;
    if (patch.experienceYearsRequired !== undefined) {
      dbPatch.experience_years_required = patch.experienceYearsRequired;
    }
    if (patch.qualifications !== undefined) dbPatch.qualifications = patch.qualifications;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.responsibilities !== undefined) {
      dbPatch.responsibilities = JSON.stringify(patch.responsibilities);
    }
    if (patch.requirements !== undefined) dbPatch.requirements = JSON.stringify(patch.requirements);
    if (patch.benefits !== undefined) dbPatch.benefits = JSON.stringify(patch.benefits);
    if (patch.contactPhone !== undefined) dbPatch.contact_phone = patch.contactPhone;
    if (patch.contactEmail !== undefined) dbPatch.contact_email = patch.contactEmail;
    if (patch.applicationDeadline !== undefined) {
      dbPatch.application_deadline = patch.applicationDeadline;
    }
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.reviewedByUserId !== undefined) dbPatch.reviewed_by_user_id = patch.reviewedByUserId;
    if (patch.reviewedAt !== undefined) dbPatch.reviewed_at = patch.reviewedAt;
    if (patch.rejectionReason !== undefined) dbPatch.rejection_reason = patch.rejectionReason;
    if (patch.closedAt !== undefined) dbPatch.closed_at = patch.closedAt;

    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as VetJobOfferRow[];
    if (!row) throw new Error('vet_job_offer not found on update');
    return rowToOffer(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(T).where({ id }).del();
  }

  // --- public browse (APPROVED, not closed, deadline not passed) --------

  async listPublic(filter: OfferBrowseFilter): Promise<{ items: VetJobOfferWithPoster[]; total: number }> {
    const today = new Date().toISOString().slice(0, 10);
    const scope = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      qb.where('o.status', 'APPROVED')
        .whereNull('o.closed_at')
        .andWhere((w) => w.whereNull('o.application_deadline').orWhere('o.application_deadline', '>=', today));
      if (filter.employmentType) qb.andWhere('o.employment_type', filter.employmentType);
      if (filter.governorate) qb.andWhere('o.governorate', filter.governorate);
      if (filter.search) {
        const s = `%${filter.search}%`;
        qb.andWhere((w) => {
          w.whereILike('o.title', s).orWhereILike('o.organization_name', s);
        });
      }
      return qb;
    };
    const countRow = await scope(this.conn()(`${T} as o`))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await scope(this.joined())
      .orderBy('o.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];
    return { items: rows.map((r) => this.map(r)), total };
  }

  // --- "my offers" (every status) + moderation queue ---------------------

  async listMine(
    postedByUserId: string,
    filter: MineFilter,
  ): Promise<{ items: VetJobOfferWithPoster[]; total: number }> {
    return this.listScoped((qb) => {
      qb.where('o.posted_by_user_id', postedByUserId);
      if (filter.status) qb.andWhere('o.status', filter.status);
    }, filter);
  }

  async listForModeration(
    filter: ModerationFilter,
  ): Promise<{ items: VetJobOfferWithPoster[]; total: number }> {
    return this.listScoped((qb) => {
      qb.andWhere('o.status', filter.status ?? 'PENDING');
    }, filter);
  }

  private async listScoped(
    scope: (qb: Knex.QueryBuilder) => void,
    filter: { page: number; pageSize: number },
  ): Promise<{ items: VetJobOfferWithPoster[]; total: number }> {
    const apply = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      scope(qb);
      return qb;
    };
    const countRow = await apply(this.conn()(`${T} as o`))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await apply(this.joined())
      .orderBy('o.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];
    const counts = await this.applicationCounts(rows.map((r) => r.id));
    return {
      items: rows.map((r) => ({ ...this.map(r), applicationCount: counts.get(r.id) ?? 0 })),
      total,
    };
  }

  /** Batched applicant-count lookup for a page of offers (owner / moderator list views). */
  private async applicationCounts(offerIds: string[]): Promise<Map<string, number>> {
    if (offerIds.length === 0) return new Map();
    const rows = (await this.conn()('vet_job_applications')
      .whereIn('job_offer_id', offerIds)
      .groupBy('job_offer_id')
      .select('job_offer_id')
      .count<{ job_offer_id: string; count: string }[]>({ count: '*' })) as {
      job_offer_id: string;
      count: string;
    }[];
    return new Map(rows.map((r) => [r.job_offer_id, Number(r.count)]));
  }
}
