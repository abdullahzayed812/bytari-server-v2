import type { Knex } from 'knex';
import {
  rowToCourse,
  type CourseBrowseFilter,
  type CreateVetCourseInput,
  type MineFilter,
  type ModerationFilter,
  type VetCourse,
  type VetCourseRow,
  type VetCourseUserSummary,
} from '../domain/vet-course.types.js';

const T = 'vet_courses';

interface JoinedRow extends VetCourseRow {
  creator_first_name: string;
  creator_last_name: string;
}

export interface VetCourseWithCreator {
  course: VetCourse;
  creator: VetCourseUserSummary;
  registrationCount?: number;
}

export class VetCourseRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  private joined(trx?: Knex.Transaction): Knex.QueryBuilder {
    return this.conn(trx)(`${T} as c`)
      .join('users as u', 'u.id', 'c.creator_user_id')
      .select('c.*', 'u.first_name as creator_first_name', 'u.last_name as creator_last_name');
  }

  private map(row: JoinedRow): VetCourseWithCreator {
    return {
      course: rowToCourse(row),
      creator: {
        id: row.creator_user_id,
        firstName: row.creator_first_name,
        lastName: row.creator_last_name,
      },
    };
  }

  async create(
    data: CreateVetCourseInput & { creatorUserId: string },
    trx: Knex.Transaction,
  ): Promise<VetCourse> {
    const [row] = (await trx(T)
      .insert({
        creator_user_id: data.creatorUserId,
        type: data.type,
        title: data.title,
        description: data.description,
        organizing_body: data.organizingBody,
        instructor_name: data.instructorName,
        instructor_specialty: data.instructorSpecialty ?? null,
        start_date: data.startDate,
        end_date: data.endDate,
        start_time: data.startTime ?? null,
        end_time: data.endTime ?? null,
        timezone_note: data.timezoneNote ?? null,
        location_mode: data.locationMode,
        location_details: data.locationDetails,
        capacity: data.capacity ?? null,
        price: data.price ?? null,
        registration_deadline: data.registrationDeadline ?? null,
        topics: JSON.stringify(data.topics ?? []),
        cover_image_storage_key: data.coverImageStorageKey ?? null,
        status: 'PENDING',
      })
      .returning('*')) as VetCourseRow[];
    if (!row) throw new Error('vet_course insert returned no row');
    return rowToCourse(row);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<VetCourse | null> {
    const row = await this.conn(trx)<VetCourseRow>(T).where({ id }).first();
    return row ? rowToCourse(row) : null;
  }

  /** Locks the row (FOR UPDATE) inside a transaction — used to serialize capacity checks. */
  async findByIdForUpdate(id: string, trx: Knex.Transaction): Promise<VetCourse | null> {
    const row = await trx<VetCourseRow>(T).where({ id }).forUpdate().first();
    return row ? rowToCourse(row) : null;
  }

  async findWithCreatorById(id: string, trx?: Knex.Transaction): Promise<VetCourseWithCreator | null> {
    const row = (await this.joined(trx).where('c.id', id).first()) as JoinedRow | undefined;
    return row ? this.map(row) : null;
  }

  /** Same as `findWithCreatorById` but also counts registrations (owner/moderator view). */
  async findWithCreatorAndCountById(id: string, trx?: Knex.Transaction): Promise<VetCourseWithCreator | null> {
    const row = (await this.joined(trx).where('c.id', id).first()) as JoinedRow | undefined;
    if (!row) return null;
    const counts = await this.registrationCounts([id]);
    return { ...this.map(row), registrationCount: counts.get(id) ?? 0 };
  }

  async update(
    id: string,
    patch: Partial<{
      type: string;
      title: string;
      description: string;
      organizingBody: string;
      instructorName: string;
      instructorSpecialty: string | null;
      startDate: string;
      endDate: string;
      startTime: string | null;
      endTime: string | null;
      timezoneNote: string | null;
      locationMode: string;
      locationDetails: string;
      capacity: number | null;
      price: string | null;
      registrationDeadline: string | null;
      topics: string[];
      coverImageStorageKey: string | null;
      status: string;
      reviewedByUserId: string | null;
      reviewedAt: Date | null;
      rejectionReason: string | null;
      cancelledAt: Date | null;
    }>,
    trx: Knex.Transaction,
  ): Promise<VetCourse> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.type !== undefined) dbPatch.type = patch.type;
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.organizingBody !== undefined) dbPatch.organizing_body = patch.organizingBody;
    if (patch.instructorName !== undefined) dbPatch.instructor_name = patch.instructorName;
    if (patch.instructorSpecialty !== undefined) dbPatch.instructor_specialty = patch.instructorSpecialty;
    if (patch.startDate !== undefined) dbPatch.start_date = patch.startDate;
    if (patch.endDate !== undefined) dbPatch.end_date = patch.endDate;
    if (patch.startTime !== undefined) dbPatch.start_time = patch.startTime;
    if (patch.endTime !== undefined) dbPatch.end_time = patch.endTime;
    if (patch.timezoneNote !== undefined) dbPatch.timezone_note = patch.timezoneNote;
    if (patch.locationMode !== undefined) dbPatch.location_mode = patch.locationMode;
    if (patch.locationDetails !== undefined) dbPatch.location_details = patch.locationDetails;
    if (patch.capacity !== undefined) dbPatch.capacity = patch.capacity;
    if (patch.price !== undefined) dbPatch.price = patch.price;
    if (patch.registrationDeadline !== undefined) {
      dbPatch.registration_deadline = patch.registrationDeadline;
    }
    if (patch.topics !== undefined) dbPatch.topics = JSON.stringify(patch.topics);
    if (patch.coverImageStorageKey !== undefined) {
      dbPatch.cover_image_storage_key = patch.coverImageStorageKey;
    }
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.reviewedByUserId !== undefined) dbPatch.reviewed_by_user_id = patch.reviewedByUserId;
    if (patch.reviewedAt !== undefined) dbPatch.reviewed_at = patch.reviewedAt;
    if (patch.rejectionReason !== undefined) dbPatch.rejection_reason = patch.rejectionReason;
    if (patch.cancelledAt !== undefined) dbPatch.cancelled_at = patch.cancelledAt;

    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as VetCourseRow[];
    if (!row) throw new Error('vet_course not found on update');
    return rowToCourse(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(T).where({ id }).del();
  }

  // --- public browse (APPROVED, not cancelled) ---------------------------

  async listPublic(filter: CourseBrowseFilter): Promise<{ items: VetCourseWithCreator[]; total: number }> {
    const scope = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      qb.where('c.status', 'APPROVED').whereNull('c.cancelled_at');
      if (filter.type) qb.andWhere('c.type', filter.type);
      if (filter.locationMode) qb.andWhere('c.location_mode', filter.locationMode);
      if (filter.search) {
        const s = `%${filter.search}%`;
        qb.andWhere((w) => {
          w.whereILike('c.title', s).orWhereILike('c.organizing_body', s).orWhereILike('c.instructor_name', s);
        });
      }
      return qb;
    };
    const countRow = await scope(this.conn()(`${T} as c`))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await scope(this.joined())
      .orderBy('c.start_date', 'asc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];
    return { items: rows.map((r) => this.map(r)), total };
  }

  // --- "my courses" (every status) + moderation queue ---------------------

  async listMine(
    creatorUserId: string,
    filter: MineFilter,
  ): Promise<{ items: VetCourseWithCreator[]; total: number }> {
    return this.listScoped((qb) => {
      qb.where('c.creator_user_id', creatorUserId);
      if (filter.status) qb.andWhere('c.status', filter.status);
    }, filter);
  }

  async listForModeration(
    filter: ModerationFilter,
  ): Promise<{ items: VetCourseWithCreator[]; total: number }> {
    return this.listScoped((qb) => {
      qb.andWhere('c.status', filter.status ?? 'PENDING');
    }, filter);
  }

  private async listScoped(
    scope: (qb: Knex.QueryBuilder) => void,
    filter: { page: number; pageSize: number },
  ): Promise<{ items: VetCourseWithCreator[]; total: number }> {
    const apply = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      scope(qb);
      return qb;
    };
    const countRow = await apply(this.conn()(`${T} as c`))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await apply(this.joined())
      .orderBy('c.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];
    const counts = await this.registrationCounts(rows.map((r) => r.id));
    return {
      items: rows.map((r) => ({ ...this.map(r), registrationCount: counts.get(r.id) ?? 0 })),
      total,
    };
  }

  /** Batched registrant-count lookup for a page of courses (owner / moderator list views). */
  private async registrationCounts(courseIds: string[]): Promise<Map<string, number>> {
    if (courseIds.length === 0) return new Map();
    const rows = (await this.conn()('vet_course_registrations')
      .whereIn('course_id', courseIds)
      .groupBy('course_id')
      .select('course_id')
      .count<{ course_id: string; count: string }[]>({ count: '*' })) as {
      course_id: string;
      count: string;
    }[];
    return new Map(rows.map((r) => [r.course_id, Number(r.count)]));
  }

  /** Registration count for one course — pass `trx` to lock/serialize (capacity checks). */
  async registrationCount(courseId: string, trx?: Knex.Transaction): Promise<number> {
    const row = await this.conn(trx)('vet_course_registrations')
      .where({ course_id: courseId })
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
  }
}
