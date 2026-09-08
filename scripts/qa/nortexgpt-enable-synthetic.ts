/**
 * Habilitación por negocio del primer paso de evaluación, sobre los negocios
 * sintéticos de la demostración y sólo en la base descartable de QA.
 *
 *   DATABASE_URL=... NORTEX_QA_DATABASE_ACK=disposable-database \
 *     node --import tsx scripts/qa/nortexgpt-enable-synthetic.ts [--dry-run]
 *
 * Habilita conversación y consultas operativas. Deja apagadas la ejecución de
 * dinero/inventario, la preparación de acciones, la extracción de documentos,
 * las promociones y el WhatsApp privado. Los interruptores globales viven en el
 * lanzador; ambos deben coincidir para que una capacidad quede activa.
 */
import prisma from '../../backend/lib/prisma.js';
import { getAssistantCapabilities } from '../../backend/services/assistant/access.js';
import { GLOBAL_BUDGET_USD, TENANT_BUDGET_USD } from '../../backend/services/assistant/budget.js';
import { validateQualityDatabase } from '../quality-gate-contract.mjs';

const MARKER = 'operativo-demo-20260905';
const TENANTS = [`${MARKER}-ferreteria`, `${MARKER}-farmacia`];
/** Tope por negocio para esta evaluación: más conservador que el límite del servidor, que no se toca. */
const QA_TENANT_BUDGET_USD = '5';
const dryRun = process.argv.includes('--dry-run');

const initialStep = {
  enabled: true,
  operationsEnabled: true,
  // Ninguna de estas se habilita por tener clave: son autorizaciones separadas.
  extractionEnabled: false,
  executionEnabled: false,
  actionsEnabled: false,
  promotionsEnabled: false,
  privateWhatsappEnabled: false,
  monthlyBudgetUsd: QA_TENANT_BUDGET_USD,
} as const;

async function main() {
  validateQualityDatabase(process.env.DATABASE_URL, process.env.NORTEX_QA_DATABASE_ACK);
  // Los interruptores globales del proceso deben reflejar el mismo paso inicial.
  process.env.NORTEX_ASSISTANT_ENABLED = 'true';
  process.env.NORTEX_ASSISTANT_OPERATIONS_ENABLED = 'true';
  for (const flag of ['NORTEX_ASSISTANT_EXTRACTION_ENABLED', 'NORTEX_ASSISTANT_EXECUTION_ENABLED', 'NORTEX_ASSISTANT_ACTIONS_ENABLED', 'NORTEX_PROMOTIONS_ENABLED', 'NORTEX_ASSISTANT_PRIVATE_WHATSAPP_ENABLED', 'NORTEX_ASSISTANT_LANGUAGE_ENABLED']) process.env[flag] = 'false';

  const applied = [];
  for (const tenantId of TENANTS) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, businessName: true, type: true } });
    if (!tenant) throw new Error(`Falta el negocio sintético ${tenantId}. Sembrá la demostración antes de habilitar.`);
    const owner = await prisma.user.findFirstOrThrow({ where: { tenantId, role: 'OWNER' }, select: { id: true, role: true } });
    const before = await prisma.assistantTenantConfig.findUnique({ where: { tenantId } });
    if (!dryRun) {
      await prisma.assistantTenantConfig.upsert({ where: { tenantId }, create: { tenantId, ...initialStep }, update: { ...initialStep } });
    }
    const after = await prisma.assistantTenantConfig.findUnique({ where: { tenantId } });
    const capabilities = await getAssistantCapabilities({ tenantId, userId: owner.id, role: owner.role }, prisma);
    applied.push({
      tenantId, businessName: tenant.businessName, vertical: tenant.type,
      before: before && { enabled: before.enabled, operations: before.operationsEnabled, actions: before.actionsEnabled, execution: before.executionEnabled, extraction: before.extractionEnabled, promotions: before.promotionsEnabled, privateWhatsapp: before.privateWhatsappEnabled, budgetUsd: before.monthlyBudgetUsd.toString() },
      after: after && { enabled: after.enabled, operations: after.operationsEnabled, actions: after.actionsEnabled, execution: after.executionEnabled, extraction: after.extractionEnabled, promotions: after.promotionsEnabled, privateWhatsapp: after.privateWhatsappEnabled, budgetUsd: after.monthlyBudgetUsd.toString() },
      effectiveCapabilities: capabilities,
    });
  }
  console.log(JSON.stringify({
    dryRun, marker: MARKER,
    serverLimits: { globalUsd: GLOBAL_BUDGET_USD, perTenantUsd: TENANT_BUDGET_USD, note: 'Constantes del servidor sin cambios.' },
    qaTenantBudgetUsd: QA_TENANT_BUDGET_USD,
    businesses: applied,
  }, null, 2));
}

main().catch(error => { console.error(`No se aplicó la habilitación: ${error instanceof Error ? error.message : 'error desconocido'}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
