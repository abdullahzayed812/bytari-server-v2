import type { Knex } from 'knex';
import {
  rowToRegistration,
  type CreateVetCourseRegistrationInput,
  type RegistrationListFilter,
  type VetCourseRegistration,
  type VetCourseRegistrationRow,
  type VetCourseUserSummary,
} from '../domain/vet-course.types.js';

const T = 'vet_course_registrations';

interface JoinedRow extends VetCourseRegistrationRow {
  registrant_first_name: string;
  registrant_last_name: string;
  course_title?: string;
  course_type?: string;
  course_start_date?: string | Date;
  course_end_date?: string | Date;
  course_location_mode?: string;
  course_organizing_body?: string;
  course_cover_image_storage_key?: string | null;
  course_cancelled_at?: Date | null;
}

export interface VetCourseRegistrationJoined {
  registration: VetCourseRegistration;
  registrant: VetCourseUserSummary;
  course?: {
    id: string;
    title: string;
    type: string;
    startDate: string;
    endDate: string;
    locationMode: string;
    organizingBody: string;
    coverImageStorageKey: string | null;
    cancelledAt: string | null;
  };
}

export class VetCourseRegistrationRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  private joined(trx?: Knex.Transaction, withCourse = false): Knex.QueryBuilder {
    const qb = this.conn(trx)(`${T} as r`)
      .join('users as u', 'u.id', 'r.registrant_user_id')
      .select('r.*', 'u.first_name as registrant_first_name', 'u.last_name as registrant_last_name');
    if (withCourse) {
      qb.join('vet_courses as c', 'c.id', 'r.course_id').select(
        'c.title as course_title',
        'c.type as course_type',
        'c.start_date as course_start_date',
        'c.end_date as course_end_date',
        'c.location_mode as course_location_mode',
        'c.organizing_body as course_organizing_body',
        'c.cover_image_storage_key as course_cover_image_storage_key',
        'c.cancelled_at as course_cancelled_at',
      );
    }
    return qb;
  }

  private map(row: JoinedRow): VetCourseRegistrationJoined {
    return {
      registration: rowToRegistration(row),
      registrant: {
        id: row.registrant_user_id,
        firstName: row.registrant_first_name,
        lastName: row.registrant_last_name,
      },
      course:
        row.course_title !== undefined
          ? {
              id: row.course_id,
              title: row.course_title,
              type: row.course_type as string,
              startDate:
                row.course_start_date instanceof Date
                  ? row.course_start_date.toISOString().slice(0, 10)
                  : (row.course_start_date as string).slice(0, 10),
              endDate:
                row.course_end_date instanceof Date
                  ? row.course_end_date.toISOString().slice(0, 10)
                  : (row.course_end_date as string).slice(0, 10),
              locationMode: row.course_location_mode as string,
              organizingBody: row.course_organizing_body as string,
              coverImageStorageKey: row.course_cover_image_storage_key ?? null,
              cancelledAt: row.course_cancelled_at ? row.course_cancelled_at.toISOString() : null,
            }
          : undefined,
    };
  }

  async create(
    data: CreateVetCourseRegistrationInput & { courseId: string; registrantUserId: string },
    trx: Knex.Transaction,
  ): Promise<VetCourseRegistration> {
    const [row] = (await trx(T)
      .insert({
        course_id: data.courseId,
        registrant_user_id: data.registrantUserId,
        full_name: data.fullName,
        phone: data.phone,
        email: data.email ?? null,
        governorate: data.governorate,
        specialty: data.specialty ?? null,
        notes: data.notes ?? null,
      })
      .returning('*')) as VetCourseRegistrationRow[];
    if (!row) throw new Error('vet_course_registration insert returned no row');
    return rowToRegistration(row);
  }

  async findJoinedById(id: string, trx?: Knex.Transaction): Promise<VetCourseRegistrationJoined | null> {
    const row = (await this.joined(trx, true).where('r.id', id).first()) as JoinedRow | undefined;
    return row ? this.map(row) : null;
  }

  async findByCourseAndRegistrant(
    courseId: string,
    registrantUserId: string,
    trx?: Knex.Transaction,
  ): Promise<VetCourseRegistration | null> {
    const row = await this.conn(trx)<VetCourseRegistrationRow>(T)
      .where({ course_id: courseId, registrant_user_id: registrantUserId })
      .first();
    return row ? rowToRegistration(row) : null;
  }

  /** Registrants of ONE course — the course's creator only. */
  async listForCourse(
    courseId: string,
    filter: RegistrationListFilter,
  ): Promise<{ items: VetCourseRegistrationJoined[]; total: number }> {
    const countRow = await this.conn()(`${T} as r`)
      .where('r.course_id', courseId)
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await this.joined(undefined, false)
      .where('r.course_id', courseId)
      .orderBy('r.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];
    return { items: rows.map((r) => this.map(r)), total };
  }

  /** The caller's own registrations ("دوراتي"). */
  async listMine(
    registrantUserId: string,
    filter: RegistrationListFilter,
  ): Promise<{ items: VetCourseRegistrationJoined[]; total: number }> {
    const countRow = await this.conn()(`${T} as r`)
      .where('r.registrant_user_id', registrantUserId)
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await this.joined(undefined, true)
      .where('r.registrant_user_id', registrantUserId)
      .orderBy('r.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];
    return { items: rows.map((r) => this.map(r)), total };
  }
}
