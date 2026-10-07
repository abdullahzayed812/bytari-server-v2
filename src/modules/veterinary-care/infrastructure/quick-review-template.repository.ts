import type { Knex } from 'knex';
import {
  rowToQuickReviewTemplate,
  type QuickReviewTemplate,
  type QuickReviewTemplateInput,
  type QuickReviewTemplateRow,
} from '../domain/veterinary-care.types.js';

const TABLE = 'clinic_quick_review_templates';

/** Legacy `clinic_quick_review_templates` — every query is scoped by the clinic id. */
export class QuickReviewTemplateRepository {
  constructor(private readonly db: Knex) {}

  async listForClinic(organizationId: string): Promise<QuickReviewTemplate[]> {
    const rows: QuickReviewTemplateRow[] = await this.db(TABLE)
      .where({ organization_id: organizationId })
      .orderBy([
        { column: 'template_type', order: 'asc' },
        { column: 'name', order: 'asc' },
      ]);
    return rows.map(rowToQuickReviewTemplate);
  }

  async findByIdForClinic(id: string, organizationId: string): Promise<QuickReviewTemplate | null> {
    const row = await this.db<QuickReviewTemplateRow>(TABLE)
      .where({ id, organization_id: organizationId })
      .first();
    return row ? rowToQuickReviewTemplate(row) : null;
  }

  async create(
    organizationId: string,
    createdByUserId: string,
    input: QuickReviewTemplateInput,
    trx: Knex.Transaction,
  ): Promise<QuickReviewTemplate> {
    const [row] = (await trx(TABLE)
      .insert({
        organization_id: organizationId,
        created_by_user_id: createdByUserId,
        name: input.name,
        template_type: input.templateType ?? 'GENERAL',
        default_diagnosis: input.defaultDiagnosis ?? null,
        default_treatment: input.defaultTreatment ?? null,
        default_notes: input.defaultNotes ?? null,
        interval_days: input.intervalDays ?? null,
      })
      .returning('*')) as QuickReviewTemplateRow[];
    if (!row) throw new Error('template insert did not return a row');
    return rowToQuickReviewTemplate(row);
  }

  async update(
    id: string,
    patch: Partial<QuickReviewTemplateInput>,
    trx: Knex.Transaction,
  ): Promise<QuickReviewTemplate> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.templateType !== undefined) dbPatch.template_type = patch.templateType;
    if (patch.defaultDiagnosis !== undefined) dbPatch.default_diagnosis = patch.defaultDiagnosis;
    if (patch.defaultTreatment !== undefined) dbPatch.default_treatment = patch.defaultTreatment;
    if (patch.defaultNotes !== undefined) dbPatch.default_notes = patch.defaultNotes;
    if (patch.intervalDays !== undefined) dbPatch.interval_days = patch.intervalDays;
    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as QuickReviewTemplateRow[];
    if (!row) throw new Error('template not found after update');
    return rowToQuickReviewTemplate(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }
}
