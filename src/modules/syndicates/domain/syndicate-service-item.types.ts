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

export interface SyndicateServiceItem {
  id: string;
  organizationId: string;
  serviceKey: SyndicateServiceKey;
  title: string | null;
  description: string | null;
  isEnabled: boolean;
  sortOrder: number;
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
    updatedAt: r.updated_at.toISOString(),
  };
}

export interface UpdateSyndicateServiceItemInput {
  title?: string | null;
  description?: string | null;
  isEnabled?: boolean;
}
