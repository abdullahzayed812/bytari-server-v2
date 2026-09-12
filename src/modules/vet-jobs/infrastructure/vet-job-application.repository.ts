import type { Knex } from 'knex';
import {
  rowToApplication,
  type ApplicationListFilter,
  type CreateVetJobApplicationInput,
  type VetJobApplication,
  type VetJobApplicationRow,
  type VetJobUserSummary,
} from '../domain/vet-job.types.js';

const T = 'vet_job_applications';

interface JoinedRow extends VetJobApplicationRow {
  applicant_first_name: string;
  applicant_last_name: string;
  offer_title?: string;
  offer_organization_name?: string;
  offer_posted_by_user_id?: string;
}

export interface VetJobApplicationJoined {
  application: VetJobApplication;
  applicant: VetJobUserSummary;
  offer?: { id: string; title: string; organizationName: string; postedByUserId: string };
}

export class VetJobApplicationRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  private joined(trx?: Knex.Transaction, withOffer = false): Knex.QueryBuilder {
    const qb = this.conn(trx)(`${T} as a`)
      .join('users as u', 'u.id', 'a.applicant_user_id')
      .select('a.*', 'u.first_name as applicant_first_name', 'u.last_name as applicant_last_name');
    if (withOffer) {
      qb.join('vet_job_offers as o', 'o.id', 'a.job_offer_id').select(
        'o.title as offer_title',
        'o.organization_name as offer_organization_name',
        'o.posted_by_user_id as offer_posted_by_user_id',
      );
    }
    return qb;
  }

  private map(row: JoinedRow): VetJobApplicationJoined {
    return {
      application: rowToApplication(row),
      applicant: {
        id: row.applicant_user_id,
        firstName: row.applicant_first_name,
        lastName: row.applicant_last_name,
      },
      offer:
        row.offer_title !== undefined
          ? {
              id: row.job_offer_id,
              title: row.offer_title,
              organizationName: row.offer_organization_name as string,
              postedByUserId: row.offer_posted_by_user_id as string,
            }
          : undefined,
    };
  }

  async create(
    data: CreateVetJobApplicationInput & { jobOfferId: string; applicantUserId: string },
    trx: Knex.Transaction,
  ): Promise<VetJobApplication> {
    const [row] = (await trx(T)
      .insert({
        job_offer_id: data.jobOfferId,
        applicant_user_id: data.applicantUserId,
        full_name: data.fullName,
        phone: data.phone,
        email: data.email ?? null,
        specialty: data.specialty ?? null,
        experience_years: data.experienceYears ?? null,
        qualifications: data.qualifications ?? null,
        cover_note: data.coverNote ?? null,
        cv_storage_key: data.cvStorageKey ?? null,
        photo_storage_key: data.photoStorageKey ?? null,
        status: 'PENDING',
      })
      .returning('*')) as VetJobApplicationRow[];
    if (!row) throw new Error('vet_job_application insert returned no row');
    return rowToApplication(row);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<VetJobApplication | null> {
    const row = await this.conn(trx)<VetJobApplicationRow>(T).where({ id }).first();
    return row ? rowToApplication(row) : null;
  }

  async findJoinedById(id: string, trx?: Knex.Transaction): Promise<VetJobApplicationJoined | null> {
    const row = (await this.joined(trx, true).where('a.id', id).first()) as JoinedRow | undefined;
    return row ? this.map(row) : null;
  }

  async findByOfferAndApplicant(
    jobOfferId: string,
    applicantUserId: string,
    trx?: Knex.Transaction,
  ): Promise<VetJobApplication | null> {
    const row = await this.conn(trx)<VetJobApplicationRow>(T)
      .where({ job_offer_id: jobOfferId, applicant_user_id: applicantUserId })
      .first();
    return row ? rowToApplication(row) : null;
  }

  async update(
    id: string,
    patch: Partial<{
      status: string;
      reviewedByUserId: string | null;
      reviewedAt: Date | null;
      conversationId: string | null;
    }>,
    trx: Knex.Transaction,
  ): Promise<VetJobApplication> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.reviewedByUserId !== undefined) dbPatch.reviewed_by_user_id = patch.reviewedByUserId;
    if (patch.reviewedAt !== undefined) dbPatch.reviewed_at = patch.reviewedAt;
    if (patch.conversationId !== undefined) dbPatch.conversation_id = patch.conversationId;
    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as VetJobApplicationRow[];
    if (!row) throw new Error('vet_job_application not found on update');
    return rowToApplication(row);
  }

  /** Applications received across ALL of the caller's job offers. */
  async listForPoster(
    postedByUserId: string,
    filter: ApplicationListFilter,
  ): Promise<{ items: VetJobApplicationJoined[]; total: number }> {
    return this.listScoped((qb) => {
      qb.where('o.posted_by_user_id', postedByUserId);
      if (filter.status) qb.andWhere('a.status', filter.status);
    }, filter);
  }

  /** Applications on ONE offer — the offer's poster only. */
  async listForOffer(
    jobOfferId: string,
    filter: ApplicationListFilter,
  ): Promise<{ items: VetJobApplicationJoined[]; total: number }> {
    return this.listScoped((qb) => {
      qb.where('a.job_offer_id', jobOfferId);
      if (filter.status) qb.andWhere('a.status', filter.status);
    }, filter);
  }

  /** The caller's own applications ("طلباتي"). */
  async listMine(
    applicantUserId: string,
    filter: ApplicationListFilter,
  ): Promise<{ items: VetJobApplicationJoined[]; total: number }> {
    return this.listScoped((qb) => {
      qb.where('a.applicant_user_id', applicantUserId);
      if (filter.status) qb.andWhere('a.status', filter.status);
    }, filter);
  }

  async listForModeration(
    filter: ApplicationListFilter,
  ): Promise<{ items: VetJobApplicationJoined[]; total: number }> {
    return this.listScoped((qb) => {
      if (filter.status) qb.andWhere('a.status', filter.status);
    }, filter);
  }

  private async listScoped(
    scope: (qb: Knex.QueryBuilder) => void,
    filter: { page: number; pageSize: number },
  ): Promise<{ items: VetJobApplicationJoined[]; total: number }> {
    const apply = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      scope(qb);
      return qb;
    };
    const countRow = await apply(
      this.conn()(`${T} as a`).join('vet_job_offers as o', 'o.id', 'a.job_offer_id'),
    )
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await apply(this.joined(undefined, true))
      .orderBy('a.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];
    return { items: rows.map((r) => this.map(r)), total };
  }
}
