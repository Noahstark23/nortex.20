import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_BUDGET_USD, MAX_APPROVED_TENANT_BUDGET_USD, effectiveAssistantBudget } from '../backend/services/assistant/budgetPolicy';

describe('autorización mensual de IA independiente de configuración legacy', () => {
  it('base US$2 y ampliación máxima vigente US$10', () => {
    expect(DEFAULT_TENANT_BUDGET_USD).toBe('2'); expect(MAX_APPROVED_TENANT_BUDGET_USD).toBe('10');
  });
  it.each([
    [null, '0'],
    [{ monthlyBudgetUsd: '10' }, '2.000000'],
    [{ monthlyBudgetUsd: '1.25' }, '1.250000'],
    [{ monthlyBudgetUsd: '10', approvedMonthlyBudgetUsd: '5.25' }, '5.250000'],
    [{ monthlyBudgetUsd: '3.25', approvedMonthlyBudgetUsd: '5.25' }, '3.250000'],
    [{ monthlyBudgetUsd: '30', approvedMonthlyBudgetUsd: '20' }, '10.000000'],
    [{ monthlyBudgetUsd: '0', approvedMonthlyBudgetUsd: '5' }, '0.000000'],
    [{ monthlyBudgetUsd: '5', approvedMonthlyBudgetUsd: '0' }, '0.000000'],
    [{ monthlyBudgetUsd: '-1', approvedMonthlyBudgetUsd: '5' }, '0'],
    [{ monthlyBudgetUsd: '5', approvedMonthlyBudgetUsd: '-1' }, '0'],
    [{ monthlyBudgetUsd: 'Infinity', approvedMonthlyBudgetUsd: '5' }, '0'],
    [{ monthlyBudgetUsd: '5', approvedMonthlyBudgetUsd: 'Infinity' }, '0'],
    [{ monthlyBudgetUsd: 'NaN', approvedMonthlyBudgetUsd: '5' }, '0'],
    [{ monthlyBudgetUsd: '5', approvedMonthlyBudgetUsd: 'NaN' }, '0'],
    [{ monthlyBudgetUsd: '0.123456', approvedMonthlyBudgetUsd: '5' }, '0.123456'],
  ] as const)('resuelve configuración %j → %s', (config, expected) => {
    expect(effectiveAssistantBudget(config)).toBe(expected);
  });
});
