import Decimal from 'decimal.js';

export const DEFAULT_TENANT_BUDGET_USD = '2';
export const MAX_APPROVED_TENANT_BUDGET_USD = '10';

/** Configuración operativa y autorización son límites distintos; ninguno borra consumo. */
export function effectiveAssistantBudget(config: { monthlyBudgetUsd: { toString(): string }; approvedMonthlyBudgetUsd?: { toString(): string } } | null): string {
  if (!config) return '0';
  const configured = new Decimal(config.monthlyBudgetUsd.toString());
  const approved = new Decimal(config.approvedMonthlyBudgetUsd?.toString() ?? DEFAULT_TENANT_BUDGET_USD);
  if (!configured.isFinite() || !approved.isFinite() || configured.isNegative() || approved.isNegative()) return '0';
  return Decimal.min(MAX_APPROVED_TENANT_BUDGET_USD, configured, approved).toFixed(6);
}
