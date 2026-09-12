import type {
  VetJobApplicationStatus,
  VetJobEmploymentType,
  VetJobModerationStatus,
} from './vet-job.constants.js';

export interface VetJobUserSummary {
  id: string;
  firstName: string;
  lastName: string;
}

// ==================================================================
//  Job offers (employer-posted, moderated)
// ==================================================================

export interface VetJobOffer {
  id: string;
  postedByUserId: string;
  organizationId: string | null;
  organizationName: string;
  title: string;
  employmentType: VetJobEmploymentType;
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
  status: VetJobModerationStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Client-safe offer shape (moderation metadata included — owner / admin view). */
export interface VetJobOfferDTO extends VetJobOffer {
  postedBy: VetJobUserSummary;
  /** Visible to the offer owner / moderators only. */
  applicationCount?: number;
}

/** Public browse projection — APPROVED, not closed, deadline not passed. */
export interface PublicVetJobOfferDTO {
  id: string;
  organizationName: string;
  title: string;
  employmentType: VetJobEmploymentType;
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
  publishedAt: string;
}

export interface VetJobOfferRow {
  id: string;
  posted_by_user_id: string;
  organization_id: string | null;
  organization_name: string;
  title: string;
  employment_type: string;
  governorate: string;
  district: string | null;
  salary_amount: string | null;
  salary_negotiable: boolean;
  experience_years_required: number | null;
  qualifications: string | null;
  description: string;
  responsibilities: string[] | null;
  requirements: string[] | null;
  benefits: string[] | null;
  contact_phone: string;
  contact_email: string | null;
  application_deadline: string | Date | null;
  status: string;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function dateOnly(v: string | Date | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : v.slice(0, 10);
}

export function rowToOffer(row: VetJobOfferRow): VetJobOffer {
  return {
    id: row.id,
    postedByUserId: row.posted_by_user_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    title: row.title,
    employmentType: row.employment_type as VetJobEmploymentType,
    governorate: row.governorate,
    district: row.district,
    salaryAmount: row.salary_amount,
    salaryNegotiable: row.salary_negotiable,
    experienceYearsRequired: row.experience_years_required,
    qualifications: row.qualifications,
    description: row.description,
    responsibilities: row.responsibilities ?? [],
    requirements: row.requirements ?? [],
    benefits: row.benefits ?? [],
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    applicationDeadline: dateOnly(row.application_deadline),
    status: row.status as VetJobModerationStatus,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    rejectionReason: row.rejection_reason,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ==================================================================
//  Seeker profiles ("باحثون عن عمل", veterinarian-created, moderated)
// ==================================================================

export interface VetJobSeekerProfile {
  id: string;
  userId: string;
  specialty: string;
  headline: string | null;
  experienceYears: number;
  governorate: string;
  district: string | null;
  qualifications: string | null;
  skills: string[];
  preferredEmploymentTypes: VetJobEmploymentType[];
  phone: string;
  email: string | null;
  cvStorageKey: string | null;
  photoStorageKey: string | null;
  status: VetJobModerationStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VetJobSeekerProfileDTO
  extends Omit<VetJobSeekerProfile, 'cvStorageKey' | 'photoStorageKey'> {
  user: VetJobUserSummary;
  cvUrl: string | null;
  photoUrl: string | null;
}

/** Public browse projection — APPROVED, not closed/withdrawn. */
export interface PublicVetJobSeekerProfileDTO {
  id: string;
  specialty: string;
  headline: string | null;
  experienceYears: number;
  governorate: string;
  district: string | null;
  qualifications: string | null;
  skills: string[];
  preferredEmploymentTypes: VetJobEmploymentType[];
  photoUrl: string | null;
  cvUrl: string | null;
  user: VetJobUserSummary;
  publishedAt: string;
}

export interface VetJobSeekerProfileRow {
  id: string;
  user_id: string;
  specialty: string;
  headline: string | null;
  experience_years: number;
  governorate: string;
  district: string | null;
  qualifications: string | null;
  skills: string[] | null;
  preferred_employment_types: string[] | null;
  phone: string;
  email: string | null;
  cv_storage_key: string | null;
  photo_storage_key: string | null;
  status: string;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToSeekerProfile(row: VetJobSeekerProfileRow): VetJobSeekerProfile {
  return {
    id: row.id,
    userId: row.user_id,
    specialty: row.specialty,
    headline: row.headline,
    experienceYears: row.experience_years,
    governorate: row.governorate,
    district: row.district,
    qualifications: row.qualifications,
    skills: row.skills ?? [],
    preferredEmploymentTypes: (row.preferred_employment_types ?? []) as VetJobEmploymentType[],
    phone: row.phone,
    email: row.email,
    cvStorageKey: row.cv_storage_key,
    photoStorageKey: row.photo_storage_key,
    status: row.status as VetJobModerationStatus,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    rejectionReason: row.rejection_reason,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ==================================================================
//  Applications (veterinarian → offer)
// ==================================================================

export interface VetJobApplication {
  id: string;
  jobOfferId: string;
  applicantUserId: string;
  fullName: string;
  phone: string;
  email: string | null;
  specialty: string | null;
  experienceYears: number | null;
  qualifications: string | null;
  coverNote: string | null;
  cvStorageKey: string | null;
  photoStorageKey: string | null;
  status: VetJobApplicationStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VetJobApplicationDTO
  extends Omit<VetJobApplication, 'cvStorageKey' | 'photoStorageKey'> {
  applicant: VetJobUserSummary;
  cvUrl: string | null;
  photoUrl: string | null;
  /** Joined offer summary — for "my applications". */
  offer?: {
    id: string;
    title: string;
    organizationName: string;
    postedByUserId: string;
  };
}

export interface VetJobApplicationRow {
  id: string;
  job_offer_id: string;
  applicant_user_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  specialty: string | null;
  experience_years: number | null;
  qualifications: string | null;
  cover_note: string | null;
  cv_storage_key: string | null;
  photo_storage_key: string | null;
  status: string;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  conversation_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToApplication(row: VetJobApplicationRow): VetJobApplication {
  return {
    id: row.id,
    jobOfferId: row.job_offer_id,
    applicantUserId: row.applicant_user_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    specialty: row.specialty,
    experienceYears: row.experience_years,
    qualifications: row.qualifications,
    coverNote: row.cover_note,
    cvStorageKey: row.cv_storage_key,
    photoStorageKey: row.photo_storage_key,
    status: row.status as VetJobApplicationStatus,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    conversationId: row.conversation_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ==================================================================
//  Input / filter shapes
// ==================================================================

export interface CreateVetJobOfferInput {
  organizationId?: string | null;
  organizationName: string;
  title: string;
  employmentType: VetJobEmploymentType;
  governorate: string;
  district?: string | null;
  salaryAmount?: string | null;
  salaryNegotiable?: boolean;
  experienceYearsRequired?: number | null;
  qualifications?: string | null;
  description: string;
  responsibilities?: string[];
  requirements?: string[];
  benefits?: string[];
  contactPhone: string;
  contactEmail?: string | null;
  applicationDeadline?: string | null;
}

export type UpdateVetJobOfferInput = Partial<CreateVetJobOfferInput>;

export interface CreateVetJobSeekerProfileInput {
  specialty: string;
  headline?: string | null;
  experienceYears?: number;
  governorate: string;
  district?: string | null;
  qualifications?: string | null;
  skills?: string[];
  preferredEmploymentTypes?: VetJobEmploymentType[];
  phone: string;
  email?: string | null;
  cvStorageKey?: string | null;
  photoStorageKey?: string | null;
}

export type UpdateVetJobSeekerProfileInput = Partial<CreateVetJobSeekerProfileInput>;

export interface CreateVetJobApplicationInput {
  fullName: string;
  phone: string;
  email?: string | null;
  specialty?: string | null;
  experienceYears?: number | null;
  qualifications?: string | null;
  coverNote?: string | null;
  cvStorageKey?: string | null;
  photoStorageKey?: string | null;
}

export interface OfferBrowseFilter {
  page: number;
  pageSize: number;
  search?: string;
  employmentType?: VetJobEmploymentType;
  governorate?: string;
}

export interface SeekerBrowseFilter {
  page: number;
  pageSize: number;
  search?: string;
  specialty?: string;
  governorate?: string;
}

export interface MineFilter {
  page: number;
  pageSize: number;
  status?: VetJobModerationStatus;
}

export interface ModerationFilter {
  page: number;
  pageSize: number;
  status?: VetJobModerationStatus;
}

export interface ApplicationListFilter {
  page: number;
  pageSize: number;
  status?: VetJobApplicationStatus;
}
