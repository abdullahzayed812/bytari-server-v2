import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  VET_COURSE_DESCRIPTION_MAX,
  VET_COURSE_LIST_ITEM_MAX,
  VET_COURSE_LOCATION_MODES,
  VET_COURSE_MAX_LIST_ITEMS,
  VET_COURSE_MODERATION_STATUSES,
  VET_COURSE_REASON_MAX,
  VET_COURSE_TEXT_MAX,
  VET_COURSE_TITLE_MAX,
  VET_COURSE_TYPES,
} from '../domain/vet-course.constants.js';

const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'invalid amount');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const isoTime = z.string().regex(/^\d{2}:\d{2}$/, 'expected HH:MM');
const topics = z.array(z.string().trim().min(1).max(VET_COURSE_LIST_ITEM_MAX)).max(VET_COURSE_MAX_LIST_ITEMS);
const phone = z.string().trim().min(5).max(30);

export const idParamSchema = z.object({ id: z.string().uuid() });

// --- cover image -------------------------------------------------

export const imageUploadUrlBodySchema = z
  .object({
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(100),
    size: z.number().int().positive(),
  })
  .strict();
export type ImageUploadUrlBody = z.infer<typeof imageUploadUrlBodySchema>;

// --- courses / seminars / workshops --------------------------------------

export const createCourseBodySchema = z
  .object({
    type: z.enum(VET_COURSE_TYPES),
    title: z.string().trim().min(3).max(VET_COURSE_TITLE_MAX),
    description: z.string().trim().min(10).max(VET_COURSE_DESCRIPTION_MAX),
    organizingBody: z.string().trim().min(1).max(VET_COURSE_TITLE_MAX),
    instructorName: z.string().trim().min(1).max(VET_COURSE_TITLE_MAX),
    instructorSpecialty: z.string().trim().max(VET_COURSE_TEXT_MAX).nullish(),
    startDate: isoDate,
    endDate: isoDate,
    startTime: isoTime.nullish(),
    endTime: isoTime.nullish(),
    timezoneNote: z.string().trim().max(120).nullish(),
    locationMode: z.enum(VET_COURSE_LOCATION_MODES),
    locationDetails: z.string().trim().min(1).max(VET_COURSE_TEXT_MAX),
    capacity: z.number().int().min(1).max(100000).nullish(),
    price: money.nullish(),
    registrationDeadline: isoDate.nullish(),
    topics: topics.optional(),
    coverImageStorageKey: z.string().trim().min(1).max(1024).nullish(),
  })
  .strict()
  .refine((v) => v.endDate >= v.startDate, { message: 'endDate must be on/after startDate', path: ['endDate'] });
export type CreateCourseBody = z.infer<typeof createCourseBodySchema>;

export const updateCourseBodySchema = z
  .object({
    type: z.enum(VET_COURSE_TYPES),
    title: z.string().trim().min(3).max(VET_COURSE_TITLE_MAX),
    description: z.string().trim().min(10).max(VET_COURSE_DESCRIPTION_MAX),
    organizingBody: z.string().trim().min(1).max(VET_COURSE_TITLE_MAX),
    instructorName: z.string().trim().min(1).max(VET_COURSE_TITLE_MAX),
    instructorSpecialty: z.string().trim().max(VET_COURSE_TEXT_MAX).nullish(),
    startDate: isoDate,
    endDate: isoDate,
    startTime: isoTime.nullish(),
    endTime: isoTime.nullish(),
    timezoneNote: z.string().trim().max(120).nullish(),
    locationMode: z.enum(VET_COURSE_LOCATION_MODES),
    locationDetails: z.string().trim().min(1).max(VET_COURSE_TEXT_MAX),
    capacity: z.number().int().min(1).max(100000).nullish(),
    price: money.nullish(),
    registrationDeadline: isoDate.nullish(),
    topics: topics.optional(),
    coverImageStorageKey: z.string().trim().min(1).max(1024).nullish(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateCourseBody = z.infer<typeof updateCourseBodySchema>;

export const courseBrowseQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  type: z.enum(VET_COURSE_TYPES).optional(),
  locationMode: z.enum(VET_COURSE_LOCATION_MODES).optional(),
});
export type CourseBrowseQuery = z.infer<typeof courseBrowseQuerySchema>;

// --- registrations --------------------------------------------------

export const createRegistrationBodySchema = z
  .object({
    fullName: z.string().trim().min(2).max(VET_COURSE_TITLE_MAX),
    phone,
    email: z.string().trim().email().nullish(),
    governorate: z.string().trim().min(1).max(80),
    specialty: z.string().trim().max(120).nullish(),
    notes: z.string().trim().max(VET_COURSE_TEXT_MAX).nullish(),
  })
  .strict();
export type CreateRegistrationBody = z.infer<typeof createRegistrationBodySchema>;

export const registrationListQuerySchema = paginationQuerySchema;
export type RegistrationListQuery = z.infer<typeof registrationListQuerySchema>;

// --- shared --------------------------------------------------

export const mineQuerySchema = paginationQuerySchema.extend({
  status: z.enum(VET_COURSE_MODERATION_STATUSES).optional(),
});
export type MineQuery = z.infer<typeof mineQuerySchema>;

export const moderationQuerySchema = paginationQuerySchema.extend({
  status: z.enum(VET_COURSE_MODERATION_STATUSES).optional(),
});
export type ModerationQuery = z.infer<typeof moderationQuerySchema>;

export const rejectBodySchema = z
  .object({ reason: z.string().trim().min(1).max(VET_COURSE_REASON_MAX) })
  .strict();
export type RejectBody = z.infer<typeof rejectBodySchema>;
