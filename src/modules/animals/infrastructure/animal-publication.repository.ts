import type { Knex } from 'knex';
import type { AnimalSex, AnimalSpecies } from '../domain/animal.constants.js';
import {
  rowToPublication,
  type AnimalPublication,
  type AnimalPublicationRow,
  type AnimalPublicationWithAnimal,
  type ListPublicationsFilter,
  type MinePublicationsFilter,
  type PublicListFilter,
  type PublicationPersonDTO,
} from '../domain/publication.types.js';
import { matchingUserIds, whereTextSearch } from '../../../shared/database/search.js';

const TABLE = 'animal_publications';

export interface CreatePublicationData {
  animalId: string;
  kind: string;
  note: string | null;
  createdByUserId: string;
  contactName: string;
  contactPhone: string;
  city: string | null;
  extraNotes: string | null;
  healthStatus: string | null;
  vaccinationStatus: string | null;
  isSterilized: boolean | null;
  lostDate: string | null;
  lostTime: string | null;
  lostGovernorate: string | null;
  lostDistrict: string | null;
  lostLocationDetail: string | null;
  healthNotes: string | null;
}

export interface ReviewPublicationData {
  status: 'APPROVED' | 'REJECTED';
  reviewedByUserId: string;
  rejectionReason: string | null;
}

export interface AdminUpdatePublicationData {
  note?: string;
  extraNotes?: string | null;
  contactName?: string;
  contactPhone?: string;
  city?: string;
  healthStatus?: string;
  vaccinationStatus?: string;
  isSterilized?: boolean;
  lostDate?: string;
  lostTime?: string | null;
  lostGovernorate?: string;
  lostDistrict?: string;
  lostLocationDetail?: string | null;
  healthNotes?: string | null;
  review?: ReviewPublicationData;
}

interface JoinedRow extends AnimalPublicationRow {
  a_id: string;
  a_name: string;
  a_species: string;
  a_breed: string | null;
  a_sex: string;
  a_date_of_birth: string | Date | null;
  a_color: string | null;
  a_distinguishing_features: string | null;
  a_age_estimate: string | null;
  a_gallery_keys: string[] | null;
}

const ANIMAL_JOIN_COLUMNS = [
  'a.id as a_id',
  'a.name as a_name',
  'a.species as a_species',
  'a.breed as a_breed',
  'a.sex as a_sex',
  'a.date_of_birth as a_date_of_birth',
  'a.color as a_color',
  'a.distinguishing_features as a_distinguishing_features',
  'a.age_estimate as a_age_estimate',
  'a.gallery_keys as a_gallery_keys',
];

function toDateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function toWithAnimal(row: JoinedRow): AnimalPublicationWithAnimal {
  return {
    ...rowToPublication(row),
    animal: {
      id: row.a_id,
      name: row.a_name,
      species: row.a_species as AnimalSpecies,
      breed: row.a_breed,
      sex: row.a_sex as AnimalSex,
      dateOfBirth: toDateOnly(row.a_date_of_birth),
      color: row.a_color,
      distinguishingFeatures: row.a_distinguishing_features,
      ageEstimate: row.a_age_estimate as never,
      galleryKeys: row.a_gallery_keys ?? [],
    },
  };
}

export class AnimalPublicationRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<AnimalPublication | null> {
    const row = await this.conn(trx)<AnimalPublicationRow>(TABLE).where({ id }).first();
    return row ? rowToPublication(row) : null;
  }

  /** A publication that MUST belong to this animal (owner-scoped read guard). */
  async findByIdForAnimal(
    id: string,
    animalId: string,
    trx?: Knex.Transaction,
  ): Promise<AnimalPublication | null> {
    const row = await this.conn(trx)<AnimalPublicationRow>(TABLE)
      .where({ id, animal_id: animalId })
      .first();
    return row ? rowToPublication(row) : null;
  }

  /** An open (PENDING) publication of `kind` for `animalId`, if any. */
  async findOpen(
    animalId: string,
    kind: string,
    trx?: Knex.Transaction,
  ): Promise<AnimalPublication | null> {
    const row = await this.conn(trx)<AnimalPublicationRow>(TABLE)
      .where({ animal_id: animalId, kind, status: 'PENDING' })
      .first();
    return row ? rowToPublication(row) : null;
  }

  async create(data: CreatePublicationData, trx: Knex.Transaction): Promise<AnimalPublication> {
    const [row] = (await trx(TABLE)
      .insert({
        animal_id: data.animalId,
        kind: data.kind,
        note: data.note,
        created_by_user_id: data.createdByUserId,
        contact_name: data.contactName,
        contact_phone: data.contactPhone,
        city: data.city,
        extra_notes: data.extraNotes,
        health_status: data.healthStatus,
        vaccination_status: data.vaccinationStatus,
        is_sterilized: data.isSterilized,
        lost_date: data.lostDate,
        lost_time: data.lostTime,
        lost_governorate: data.lostGovernorate,
        lost_district: data.lostDistrict,
        lost_location_detail: data.lostLocationDetail,
        health_notes: data.healthNotes,
      })
      .returning('*')) as AnimalPublicationRow[];
    if (!row) throw new Error('publication insert did not return a row');
    return rowToPublication(row);
  }

  async review(
    id: string,
    data: ReviewPublicationData,
    trx: Knex.Transaction,
  ): Promise<AnimalPublication> {
    const [row] = (await trx(TABLE)
      .where({ id })
      .update({
        status: data.status,
        reviewed_by_user_id: data.reviewedByUserId,
        reviewed_at: new Date(),
        rejection_reason: data.status === 'REJECTED' ? data.rejectionReason : null,
        updated_at: new Date(),
      })
      .returning('*')) as AnimalPublicationRow[];
    if (!row) throw new Error('publication not found after review');
    return rowToPublication(row);
  }

  /** Moderator edit — only the provided columns change; `undefined` keys are skipped. */
  async adminUpdate(
    id: string,
    data: AdminUpdatePublicationData,
    trx: Knex.Transaction,
  ): Promise<AnimalPublication> {
    const patch: Record<string, unknown> = {
      note: data.note,
      extra_notes: data.extraNotes,
      contact_name: data.contactName,
      contact_phone: data.contactPhone,
      city: data.city,
      health_status: data.healthStatus,
      vaccination_status: data.vaccinationStatus,
      is_sterilized: data.isSterilized,
      lost_date: data.lostDate,
      lost_time: data.lostTime,
      lost_governorate: data.lostGovernorate,
      lost_district: data.lostDistrict,
      lost_location_detail: data.lostLocationDetail,
      health_notes: data.healthNotes,
      updated_at: new Date(),
    };
    if (data.review) {
      patch.status = data.review.status;
      patch.reviewed_by_user_id = data.review.reviewedByUserId;
      patch.reviewed_at = new Date();
      patch.rejection_reason =
        data.review.status === 'REJECTED' ? data.review.rejectionReason : null;
    }
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
    const [row] = (await trx(TABLE)
      .where({ id })
      .update(patch)
      .returning('*')) as AnimalPublicationRow[];
    if (!row) throw new Error('publication not found after admin update');
    return rowToPublication(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  /** All publications for one animal (owner / admin view), newest first. */
  async listForAnimal(
    animalId: string,
    filter: { page: number; pageSize: number },
    trx?: Knex.Transaction,
  ): Promise<{ items: AnimalPublication[]; total: number }> {
    const base = (): Knex.QueryBuilder =>
      this.conn(trx)<AnimalPublicationRow>(TABLE).where('animal_id', animalId);

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: AnimalPublicationRow[] = await base()
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToPublication), total };
  }

  /**
   * Moderation listing (admin / animal supervisor). Filter by kind / status.
   * Joined with the animal summary — a reviewer decides on a listing WITH the
   * animal's photos, same join the public browse uses.
   */
  async listForModeration(
    filter: ListPublicationsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: AnimalPublicationWithAnimal[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)(`${TABLE} as p`).join('animals as a', 'a.id', 'p.animal_id');
      if (filter.kind) qb.where('p.kind', filter.kind);
      if (filter.status) qb.where('p.status', filter.status);
      if (filter.search) {
        // Animal name / breed / code, listing contact & location, ids, or the submitter.
        const term = filter.search;
        qb.where((w) => {
          whereTextSearch(w, term, {
            columns: [
              'a.name',
              'a.breed',
              'a.public_code',
              'p.contact_name',
              'p.contact_phone',
              'p.city',
              'p.lost_governorate',
              'p.lost_district',
            ],
            ids: ['p.id', 'a.id'],
          });
          void w.orWhereIn('p.created_by_user_id', matchingUserIds(this.conn(trx), term));
        });
      }
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: JoinedRow[] = await base()
      .orderBy('p.created_at', 'asc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select('p.*', ...ANIMAL_JOIN_COLUMNS);

    return { items: rows.map(toWithAnimal), total };
  }

  /**
   * Moderation only: the submitting account and the animal's CURRENT owner for
   * each publication — real relationships (`created_by_user_id`,
   * `animal_ownerships.ended_at IS NULL`), never inferred from listing text.
   * Selects contact columns explicitly (no password hash / keys).
   */
  async findModerationPeople(
    publicationIds: string[],
    trx?: Knex.Transaction,
  ): Promise<
    Map<
      string,
      { submittedBy: PublicationPersonDTO | null; currentOwner: PublicationPersonDTO | null }
    >
  > {
    const out = new Map<
      string,
      { submittedBy: PublicationPersonDTO | null; currentOwner: PublicationPersonDTO | null }
    >();
    if (publicationIds.length === 0) return out;
    const rows: Array<Record<string, string | null>> = await this.conn(trx)(`${TABLE} as p`)
      .leftJoin('users as su', 'su.id', 'p.created_by_user_id')
      .leftJoin('animal_ownerships as o', function joinCurrent() {
        this.on('o.animal_id', 'p.animal_id').andOnNull('o.ended_at');
      })
      .leftJoin('users as ou', 'ou.id', 'o.owner_user_id')
      .whereIn('p.id', publicationIds)
      .select(
        'p.id as id',
        ...['id', 'first_name', 'last_name', 'email', 'phone', 'whatsapp'].flatMap((c) => [
          `su.${c} as su_${c}`,
          `ou.${c} as ou_${c}`,
        ]),
      );
    const person = (
      r: Record<string, string | null>,
      p: 'su' | 'ou',
    ): PublicationPersonDTO | null =>
      r[`${p}_id`]
        ? {
            id: r[`${p}_id`] as string,
            firstName: r[`${p}_first_name`] ?? '',
            lastName: r[`${p}_last_name`] ?? '',
            email: r[`${p}_email`] ?? '',
            phone: r[`${p}_phone`] ?? null,
            whatsapp: r[`${p}_whatsapp`] ?? null,
          }
        : null;
    for (const r of rows) {
      out.set(r.id as string, { submittedBy: person(r, 'su'), currentOwner: person(r, 'ou') });
    }
    return out;
  }

  /** One publication of ANY status, joined with the animal summary (moderation detail). */
  async findByIdWithAnimal(
    id: string,
    trx?: Knex.Transaction,
  ): Promise<AnimalPublicationWithAnimal | null> {
    const row: JoinedRow | undefined = await this.conn(trx)(`${TABLE} as p`)
      .join('animals as a', 'a.id', 'p.animal_id')
      .where('p.id', id)
      .select('p.*', ...ANIMAL_JOIN_COLUMNS)
      .first();
    return row ? toWithAnimal(row) : null;
  }

  /** Public browse — APPROVED publications only, joined with the animal summary. */
  async listPublicApproved(
    filter: PublicListFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: AnimalPublicationWithAnimal[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)(`${TABLE} as p`)
        .join('animals as a', 'a.id', 'p.animal_id')
        // A FOUND / ADOPTED / MATED / CLOSED listing STAYS in the browse (final
        // corrections §4) — shown locked with its outcome; requests on it are
        // refused server-side (409 PUBLICATION_RESOLVED).
        .where('p.status', 'APPROVED');
      if (filter.kind) qb.andWhere('p.kind', filter.kind);
      if (filter.species) qb.andWhere('a.species', filter.species);
      if (filter.search) {
        qb.andWhereRaw('lower(a.name) like ?', [`%${filter.search.toLowerCase()}%`]);
      }
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: JoinedRow[] = await base()
      // still-available listings first, then the resolved ones
      .orderByRaw('(p.resolution IS NOT NULL) ASC')
      .orderBy('p.reviewed_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select('p.*', ...ANIMAL_JOIN_COLUMNS);

    return { items: rows.map(toWithAnimal), total };
  }

  /**
   * "My listings" — the caller's own publications of EVERY status, joined with
   * the animal summary. `createdByUserId` comes from the authenticated session,
   * never the request body.
   */
  async listMineWithAnimal(
    createdByUserId: string,
    filter: MinePublicationsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: AnimalPublicationWithAnimal[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)(`${TABLE} as p`)
        .join('animals as a', 'a.id', 'p.animal_id')
        .where('p.created_by_user_id', createdByUserId);
      if (filter.kind) qb.andWhere('p.kind', filter.kind);
      if (filter.status) qb.andWhere('p.status', filter.status);
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: JoinedRow[] = await base()
      .orderBy('p.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select('p.*', ...ANIMAL_JOIN_COLUMNS);

    return { items: rows.map(toWithAnimal), total };
  }

  /** One APPROVED publication for public detail, joined with the animal summary. */
  async findPublicApprovedById(
    id: string,
    trx?: Knex.Transaction,
  ): Promise<AnimalPublicationWithAnimal | null> {
    const row: JoinedRow | undefined = await this.conn(trx)(`${TABLE} as p`)
      .join('animals as a', 'a.id', 'p.animal_id')
      .where({ 'p.id': id, 'p.status': 'APPROVED' })
      .select('p.*', ...ANIMAL_JOIN_COLUMNS)
      .first();
    return row ? toWithAnimal(row) : null;
  }

  /** Owner sets (or clears, with `null`) the listing's outcome. */
  async setResolution(
    id: string,
    resolution: string | null,
    resolvedByUserId: string,
    trx: Knex.Transaction,
  ): Promise<AnimalPublication | null> {
    const [row] = (await trx(TABLE)
      .where({ id })
      .update({
        resolution,
        resolved_at: resolution ? trx.fn.now() : null,
        resolved_by_user_id: resolution ? resolvedByUserId : null,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as AnimalPublicationRow[];
    return row ? rowToPublication(row) : null;
  }
}
