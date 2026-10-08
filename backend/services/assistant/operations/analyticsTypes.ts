import type { PrismaClient } from '@prisma/client';

export interface AnalyticsDependencies { db?: PrismaClient; now?: () => Date }
export interface OperationsPeriod {
  startDate: string; endDate: string; cutoff: string; timeZone: 'America/Managua';
  completeDays: boolean;
}
export interface OperationsMetric {
  key: string; label: string; value: string | null;
  unit: 'money' | 'count' | 'quantity' | 'percent' | 'days';
  status: 'ok' | 'unavailable'; source: string;
}
export interface OperationsResult {
  kind: string; status: 'ok' | 'partial' | 'unavailable'; checkedAt: string;
  period: OperationsPeriod; metrics: OperationsMetric[]; evidence: string[]; warnings: string[];
}
export interface BusinessHealthResult extends OperationsResult {
  kind: 'BUSINESS_HEALTH';
  comparison: { period: OperationsPeriod; metrics: OperationsMetric[]; changes: OperationsMetric[] };
}
export interface InventoryBurnRateRow {
  productId: string; name: string; unit: string; quantityStep: string | null; supplierId: string | null;
  physicalStock: string | null; sellableStock: string | null; soldBaseQuantity: string | null;
  returnedBaseQuantity: string | null; netBaseQuantity: string | null; dailyAverage: string | null;
  restockedBaseQuantity: string | null; quarantinedBaseQuantity: string | null; lostBaseQuantity: string | null;
  stockConsumptionBaseQuantity: string | null;
  historyStatus: 'SUFFICIENT' | 'INSUFFICIENT'; historyAvailableDays: number | null; historyRequiredDays: number;
  configuredMinimum: string | null; configuredMaximum: string | null;
  suggestionBasis: 'CONFIGURED_MINIMUM' | 'CONFIGURED_MAXIMUM' | 'RECORDED_RATE' | null;
  estimatedDaysRemaining: string | null; pendingOrderQuantity: string | null; suggestedQuantity: string | null;
  cost?: string | null; status: 'ok' | 'partial' | 'unavailable'; warnings: string[];
}
export interface InventoryBurnRateResult extends OperationsResult { kind: 'INVENTORY_BURN_RATE'; rows: InventoryBurnRateRow[] }
export interface BatchExpiryRow {
  batchId: string; batchNumber: string; productId: string; name: string; unit: string; quantityStep: string | null;
  supplierId: string | null; expiryDate: string; physicalStock: string | null; warehouseId: string | null;
  sellableStock: string | null; state: 'EXPIRED' | 'EXPIRING'; status: 'ok' | 'unavailable';
  allowedActions: Array<'BATCH_WRITEOFF' | 'SUPPLIER_RETURN'>; warnings: string[];
}
export interface BatchExpiryResult extends OperationsResult { kind: 'BATCH_EXPIRY'; rows: BatchExpiryRow[] }
