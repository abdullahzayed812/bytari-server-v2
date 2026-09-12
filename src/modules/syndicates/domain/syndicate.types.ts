import type { SyndicateAnnouncementType, SyndicateRequestType, SyndicateSubmissionKind, SyndicateSubmissionStatus } from './syndicate.constants.js';

export interface SyndicateUserSummary {
  id: string;
  firstName: string;
  lastName: string;
}

// ==================================================================
//  Syndicate profile (an `organizations` row of type SYNDICATE + its
//  `syndicate_details` extension row)
// ==================================================================

export interface SyndicateDetails {
  parentOrganizationId: string | null;
  governorate: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoStorageKey: string | null;
  headOfficerName: string | null;
  headOfficerTitle: string | null;
  termStartYear: number | null;
  termEndYear: number | null;
}

export interface SyndicateDetailsRow {
  organization_id: string;
  parent_organization_id: string | null;
  governorate: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_key: string | null;
  head_officer_name: string | null;
  head_officer_title: string | null;
  term_start_year: number | null;
  term_end_year: number | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToSyndicateDetails(row: SyndicateDetailsRow): SyndicateDetails {
  return {
    parentOrganizationId: row.parent_organization_id,
    governorate: row.governorate,
    address: row.address,
    phone: row.phone,
    email: row.email,
    website: row.website,
    logoStorageKey: row.logo_key,
    headOfficerName: row.head_officer_name,
    headOfficerTitle: row.head_officer_title,
    termStartYear: row.term_start_year,
    termEndYear: row.term_end_year,
  };
}

/** Public syndicate profile — the main/branch home + branch-list card shape. */
export interface PublicSyndicateDTO {
  id: string;
  parentOrganizationId: string | null;
  name: string;
  description: string | null;
  status: string;
  governorate: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;
  headOfficerName: string | null;
  headOfficerTitle: string | null;
  termStartYear: number | null;
  termEndYear: number | null;
  /** Only meaningful for a MAIN syndicate (`parentOrganizationId === null`). */
  branchCount: number;
  isFollowing: boolean;
  followersCount: number;
  createdAt: string;
}

export interface CreateSyndicateInput {
  parentOrganizationId?: string | null;
  name: string;
  description?: string | null;
  governorate?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  headOfficerName?: string | null;
  headOfficerTitle?: string | null;
  termStartYear?: number | null;
  termEndYear?: number | null;
}

export interface UpdateSyndicateProfileInput {
  name?: string;
  description?: string | null;
  governorate?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoStorageKey?: string | null;
  headOfficerName?: string | null;
  headOfficerTitle?: string | null;
  termStartYear?: number | null;
  termEndYear?: number | null;
}

export interface SyndicateBrowseFilter {
  page: number;
  pageSize: number;
  search?: string;
}

/**
 * "What can I do here?" — computed from the org-scoped membership context
 * (`AuthorizationService.getOrganizationMembershipContext`), never from the
 * global role alone. Drives whether the mobile app shows management actions
 * (e.g. "الطلبات والاستفسارات") for THIS specific syndicate — an ADMIN or
 * the syndicate's OWNER (the creating admin) sees everything; an assigned
 * SUPERVISOR sees only what they were explicitly granted.
 */
export interface MySyndicateAccessDTO {
  isAdmin: boolean;
  isOwner: boolean;
  canManageProfile: boolean;
  canManageAnnouncements: boolean;
  canReadSubmissions: boolean;
  canRespondSubmissions: boolean;
}

// ==================================================================
//  Announcements ("الإعلانات والتبليغات")
// ==================================================================

export interface SyndicateAnnouncement {
  id: string;
  organizationId: string;
  type: SyndicateAnnouncementType;
  title: string;
  body: string;
  imageStorageKey: string | null;
  createdByUserId: string;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyndicateAnnouncementDTO extends Omit<SyndicateAnnouncement, 'imageStorageKey'> {
  imageUrl: string | null;
  syndicateName: string;
}

export interface SyndicateAnnouncementRow {
  id: string;
  organization_id: string;
  type: string;
  title: string;
  body: string;
  image_key: string | null;
  created_by_user_id: string;
  published_at: Date;
  created_at: Date;
  updated_at: Date;
}

export function rowToAnnouncement(row: SyndicateAnnouncementRow): SyndicateAnnouncement {
  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type as SyndicateAnnouncementType,
    title: row.title,
    body: row.body,
    imageStorageKey: row.image_key,
    createdByUserId: row.created_by_user_id,
    publishedAt: row.published_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface CreateAnnouncementInput {
  type: SyndicateAnnouncementType;
  title: string;
  body: string;
  imageStorageKey?: string | null;
}

export type UpdateAnnouncementInput = Partial<CreateAnnouncementInput>;

export interface AnnouncementListFilter {
  page: number;
  pageSize: number;
}

// ==================================================================
//  Submissions ("طلبات" + "استفسارات")
// ==================================================================

export interface SyndicateSubmission {
  id: string;
  organizationId: string;
  kind: SyndicateSubmissionKind;
  requestType: SyndicateRequestType | null;
  message: string;
  attachmentStorageKeys: string[];
  submittedByUserId: string;
  status: SyndicateSubmissionStatus;
  responseText: string | null;
  respondedByUserId: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyndicateSubmissionDTO extends Omit<SyndicateSubmission, 'attachmentStorageKeys'> {
  attachmentUrls: string[];
  submittedBy: SyndicateUserSummary;
  syndicateName: string;
}

export interface SyndicateSubmissionRow {
  id: string;
  organization_id: string;
  kind: string;
  request_type: string | null;
  message: string;
  attachment_keys: string[] | null;
  submitted_by_user_id: string;
  status: string;
  response_text: string | null;
  responded_by_user_id: string | null;
  responded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToSubmission(row: SyndicateSubmissionRow): SyndicateSubmission {
  return {
    id: row.id,
    organizationId: row.organization_id,
    kind: row.kind as SyndicateSubmissionKind,
    requestType: row.request_type as SyndicateRequestType | null,
    message: row.message,
    attachmentStorageKeys: row.attachment_keys ?? [],
    submittedByUserId: row.submitted_by_user_id,
    status: row.status as SyndicateSubmissionStatus,
    responseText: row.response_text,
    respondedByUserId: row.responded_by_user_id,
    respondedAt: row.responded_at ? row.responded_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface CreateSubmissionInput {
  kind: SyndicateSubmissionKind;
  requestType?: SyndicateRequestType | null;
  message: string;
  attachmentStorageKeys?: string[];
}

export interface SubmissionListFilter {
  page: number;
  pageSize: number;
  kind?: SyndicateSubmissionKind;
  status?: SyndicateSubmissionStatus;
}

export interface MySubmissionListFilter {
  page: number;
  pageSize: number;
  kind?: SyndicateSubmissionKind;
}
