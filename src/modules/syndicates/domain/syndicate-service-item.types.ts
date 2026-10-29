/**
 * "الخدمات" of a syndicate (`syndicate_services`): one row per fixed service
 * key per syndicate. `title` / `description` NULL = the app's built-in text.
 */
export const SYNDICATE_SERVICE_KEYS = [
  'ID_CARD',
  'INQUIRY',
  'ANNOUNCEMENTS',
  'REGISTER_DOCTORS',
  'LEGAL_SUPPORT',
  'OFFICE_LICENSES',
] as const;
export type SyndicateServiceKey = (typeof SYNDICATE_SERVICE_KEYS)[number];

/** Services that have an internal content page (the others are a form / list / flow). */
export const SYNDICATE_CONTENT_SERVICE_KEYS = [
  'ID_CARD',
  'LEGAL_SUPPORT',
  'OFFICE_LICENSES',
] as const;

export const SYNDICATE_CONTENT_SECTION_STYLES = ['CHECK', 'NOTE'] as const;
export type SyndicateContentSectionStyle = (typeof SYNDICATE_CONTENT_SECTION_STYLES)[number];

/**
 * A service page's editable content. Array order IS the display order. Ids
 * are stable keys for the editor (kept across saves, assigned when missing).
 */
export interface SyndicateServiceContent {
  /** The label above the sections ("المتطلبات" / "معلومات الخدمة"). */
  heading: string | null;
  /** Intro paragraph under the heading. */
  body: string | null;
  sections: Array<{
    id: string;
    title: string;
    /** CHECK = green ✓ bullets (requirements), NOTE = amber ! bullets (notes). */
    style: SyndicateContentSectionStyle;
    items: Array<{ id: string; text: string }>;
  }>;
  /** Small muted line after the sections (e.g. processing time). */
  footnote: string | null;
  /** Info box at the bottom. */
  note: string | null;
}

export interface SyndicateServiceItem {
  id: string;
  organizationId: string;
  serviceKey: SyndicateServiceKey;
  title: string | null;
  description: string | null;
  isEnabled: boolean;
  sortOrder: number;
  /** `null` = the app's built-in page content; only content-page services may have one. */
  content: SyndicateServiceContent | null;
  updatedAt: string;
}

export interface SyndicateServiceItemRow {
  id: string;
  organization_id: string;
  service_key: string;
  title: string | null;
  description: string | null;
  is_enabled: boolean;
  sort_order: number;
  content: SyndicateServiceContent | null;
  updated_at: Date;
}

export function rowToSyndicateServiceItem(r: SyndicateServiceItemRow): SyndicateServiceItem {
  return {
    id: r.id,
    organizationId: r.organization_id,
    serviceKey: r.service_key as SyndicateServiceKey,
    title: r.title,
    description: r.description,
    isEnabled: r.is_enabled,
    sortOrder: r.sort_order,
    content: r.content ?? null,
    updatedAt: r.updated_at.toISOString(),
  };
}

export interface UpdateSyndicateServiceItemInput {
  title?: string | null;
  description?: string | null;
  isEnabled?: boolean;
  /** Replaces the whole document (`null` = back to the built-in content). */
  content?: SyndicateServiceContentInput | null;
}

/** As sent by the editor — a new section / item has no id yet. */
export interface SyndicateServiceContentInput extends Omit<SyndicateServiceContent, 'sections'> {
  sections: Array<{
    id?: string;
    title: string;
    style: SyndicateContentSectionStyle;
    items: Array<{ id?: string; text: string }>;
  }>;
}

/** What the repository persists: ids already assigned. */
export type SyndicateServiceItemPatch = Omit<UpdateSyndicateServiceItemInput, 'content'> & {
  content?: SyndicateServiceContent | null;
};
