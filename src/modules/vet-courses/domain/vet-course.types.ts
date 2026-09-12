import type { VetCourseLocationMode, VetCourseModerationStatus, VetCourseType } from './vet-course.constants.js';

export interface VetCourseUserSummary {
  id: string;
  firstName: string;
  lastName: string;
}

// ==================================================================
//  Courses / Seminars / Workshops (veterinarian-created, moderated)
// ==================================================================

export interface VetCourse {
  id: string;
  creatorUserId: string;
  type: VetCourseType;
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
  locationMode: VetCourseLocationMode;
  locationDetails: string;
  capacity: number | null;
  price: string | null;
  registrationDeadline: string | null;
  topics: string[];
  coverImageStorageKey: string | null;
  status: VetCourseModerationStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Client-safe course shape (moderation metadata included — owner / admin view). */
export interface VetCourseDTO extends Omit<VetCourse, 'coverImageStorageKey'> {
  creator: VetCourseUserSummary;
  coverImageUrl: string | null;
  /** Visible to the creator / moderators only. */
  registrationCount?: number;
}

/** Public browse / details projection — APPROVED, not cancelled. */
export interface PublicVetCourseDTO {
  id: string;
  type: VetCourseType;
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
  locationMode: VetCourseLocationMode;
  locationDetails: string;
  capacity: number | null;
  remainingSeats: number | null;
  price: string | null;
  registrationDeadline: string | null;
  topics: string[];
  coverImageUrl: string | null;
  publishedAt: string;
}

export interface VetCourseRow {
  id: string;
  creator_user_id: string;
  type: string;
  title: string;
  description: string;
  organizing_body: string;
  instructor_name: string;
  instructor_specialty: string | null;
  start_date: string | Date;
  end_date: string | Date;
  start_time: string | null;
  end_time: string | null;
  timezone_note: string | null;
  location_mode: string;
  location_details: string;
  capacity: number | null;
  price: string | null;
  registration_deadline: string | Date | null;
  topics: string[] | null;
  cover_image_storage_key: string | null;
  status: string;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function dateOnly(v: string | Date | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : v.slice(0, 10);
}

export function rowToCourse(row: VetCourseRow): VetCourse {
  return {
    id: row.id,
    creatorUserId: row.creator_user_id,
    type: row.type as VetCourseType,
    title: row.title,
    description: row.description,
    organizingBody: row.organizing_body,
    instructorName: row.instructor_name,
    instructorSpecialty: row.instructor_specialty,
    startDate: dateOnly(row.start_date) as string,
    endDate: dateOnly(row.end_date) as string,
    startTime: row.start_time,
    endTime: row.end_time,
    timezoneNote: row.timezone_note,
    locationMode: row.location_mode as VetCourseLocationMode,
    locationDetails: row.location_details,
    capacity: row.capacity,
    price: row.price,
    registrationDeadline: dateOnly(row.registration_deadline),
    topics: row.topics ?? [],
    coverImageStorageKey: row.cover_image_storage_key,
    status: row.status as VetCourseModerationStatus,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    rejectionReason: row.rejection_reason,
    cancelledAt: row.cancelled_at ? row.cancelled_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ==================================================================
//  Registrations (veterinarian → course)
// ==================================================================

export interface VetCourseRegistration {
  id: string;
  courseId: string;
  registrantUserId: string;
  fullName: string;
  phone: string;
  email: string | null;
  governorate: string;
  specialty: string | null;
  notes: string | null;
  createdAt: string;
}

export interface VetCourseRegistrationDTO extends VetCourseRegistration {
  registrant: VetCourseUserSummary;
  course?: {
    id: string;
    title: string;
    type: VetCourseType;
    startDate: string;
    endDate: string;
    locationMode: VetCourseLocationMode;
    organizingBody: string;
    coverImageUrl: string | null;
    cancelledAt: string | null;
  };
}

export interface VetCourseRegistrationRow {
  id: string;
  course_id: string;
  registrant_user_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  governorate: string;
  specialty: string | null;
  notes: string | null;
  created_at: Date;
}

export function rowToRegistration(row: VetCourseRegistrationRow): VetCourseRegistration {
  return {
    id: row.id,
    courseId: row.course_id,
    registrantUserId: row.registrant_user_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    governorate: row.governorate,
    specialty: row.specialty,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
  };
}

// ==================================================================
//  Input / filter shapes
// ==================================================================

export interface CreateVetCourseInput {
  type: VetCourseType;
  title: string;
  description: string;
  organizingBody: string;
  instructorName: string;
  instructorSpecialty?: string | null;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  timezoneNote?: string | null;
  locationMode: VetCourseLocationMode;
  locationDetails: string;
  capacity?: number | null;
  price?: string | null;
  registrationDeadline?: string | null;
  topics?: string[];
  coverImageStorageKey?: string | null;
}

export type UpdateVetCourseInput = Partial<CreateVetCourseInput>;

export interface CreateVetCourseRegistrationInput {
  fullName: string;
  phone: string;
  email?: string | null;
  governorate: string;
  specialty?: string | null;
  notes?: string | null;
}

export interface CourseBrowseFilter {
  page: number;
  pageSize: number;
  search?: string;
  type?: VetCourseType;
  locationMode?: VetCourseLocationMode;
}

export interface MineFilter {
  page: number;
  pageSize: number;
  status?: VetCourseModerationStatus;
}

export interface ModerationFilter {
  page: number;
  pageSize: number;
  status?: VetCourseModerationStatus;
}

export interface RegistrationListFilter {
  page: number;
  pageSize: number;
}
