import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { PoultryOpsAuditAction, PoultryOpsAuditEntity } from '../domain/poultry-ops.constants.js';
import type {
  CreateFarmExpenseInput,
  FarmExpense,
  FarmExpenseSummary,
  ListFarmExpensesFilter,
  UpdateFarmExpenseInput,
} from '../domain/poultry-ops.types.js';
import type { FarmExpenseRepository } from '../infrastructure/farm-expense.repository.js';

export interface FarmActor {
  actorUserId: string;
  context?: AuditContext;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function addDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "المصاريف" — farm-scoped expenses + the three summary cards at the top. */
export class FarmExpenseService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly expenses: FarmExpenseRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'farm-expense-service' });
  }

  list(
    organizationId: string,
    filter: ListFarmExpensesFilter,
  ): Promise<{ items: FarmExpense[]; total: number }> {
    return this.expenses.listForOrganization(organizationId, filter);
  }

  async get(organizationId: string, expenseId: string): Promise<FarmExpense> {
    const expense = await this.expenses.findByIdForOrganization(expenseId, organizationId);
    if (!expense) throw new NotFoundError('Expense not found');
    return expense;
  }

  async summary(organizationId: string): Promise<FarmExpenseSummary> {
    const now = new Date();
    const monthStart = `${now.toISOString().slice(0, 7)}-01`;
    const todayStr = now.toISOString().slice(0, 10);
    const weekStart = addDays(now, -6);

    const [totalThisWeek, totalThisMonth] = await Promise.all([
      this.expenses.sumInRange(organizationId, weekStart, todayStr),
      this.expenses.sumInRange(organizationId, monthStart, todayStr),
    ]);
    const daysElapsed = now.getUTCDate();
    return {
      totalThisWeek: round2(totalThisWeek),
      totalThisMonth: round2(totalThisMonth),
      dailyAverageThisMonth: round2(totalThisMonth / Math.max(1, daysElapsed)),
    };
  }

  async create(
    organizationId: string,
    input: CreateFarmExpenseInput,
    actor: FarmActor,
  ): Promise<FarmExpense> {
    const expense = await this.db.transaction(async (tx) => {
      const created = await this.expenses.create(
        { ...input, organizationId, createdByUserId: actor.actorUserId },
        tx,
      );
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.FARM_EXPENSE_CREATED,
          entityType: PoultryOpsAuditEntity.FARM_EXPENSE,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, category: input.category },
          context: actor.context,
        },
        tx,
      );
      return created;
    });
    this.events.publish('farm.expense.created', { organizationId, expenseId: expense.id });
    return expense;
  }

  async update(
    organizationId: string,
    expenseId: string,
    patch: UpdateFarmExpenseInput,
    actor: FarmActor,
  ): Promise<FarmExpense> {
    const existing = await this.expenses.findByIdForOrganization(expenseId, organizationId);
    if (!existing) throw new NotFoundError('Expense not found');
    return this.db.transaction(async (tx) => {
      const updated = await this.expenses.update(expenseId, patch, tx);
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.FARM_EXPENSE_UPDATED,
          entityType: PoultryOpsAuditEntity.FARM_EXPENSE,
          entityId: expenseId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return updated;
    });
  }

  async delete(organizationId: string, expenseId: string, actor: FarmActor): Promise<void> {
    const existing = await this.expenses.findByIdForOrganization(expenseId, organizationId);
    if (!existing) throw new NotFoundError('Expense not found');
    await this.db.transaction(async (tx) => {
      await this.expenses.deleteById(expenseId, tx);
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.FARM_EXPENSE_DELETED,
          entityType: PoultryOpsAuditEntity.FARM_EXPENSE,
          entityId: expenseId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId },
          context: actor.context,
        },
        tx,
      );
    });
  }
}
