import type { PrismaClient } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { ACCOUNTING_READ_ROLES, POS_SALE_ROLES, PURCHASE_WRITE_ROLES, SUPPLIER_RETURN_WRITE_ROLES } from '../../middleware/accessPolicies.js';
import type { AssistantCapabilities, AssistantPrincipal } from '../../../shared/assistant.js';
import { getAssistantFlags } from './config.js';
import { canManageAssistantBudget } from './budgetAuthority.js';
import { canReadShiftReport } from '../../lib/salesReport.js';

export class AssistantAccessError extends Error {
    constructor(public statusCode: number, public code: string, message: string) {
        super(message);
        this.name = 'AssistantAccessError';
    }
}

export const ASSISTANT_KNOWN_ROLES = [
    ...POS_SALE_ROLES, 'ACCOUNTANT', 'VIEWER', 'BODEGUERO', 'LENDER', 'DRIVER',
];
export const ASSISTANT_FINANCIAL_ROLES = ACCOUNTING_READ_ROLES;
export const ASSISTANT_BUSINESS_SALES_ROLES = [...ACCOUNTING_READ_ROLES, 'MANAGER'];
export const ASSISTANT_OWN_SALES_ROLES = ['CASHIER', 'EMPLOYEE', 'VENDEDOR'];
export const ASSISTANT_INVENTORY_ROLES = [...ACCOUNTING_READ_ROLES, 'MANAGER', 'BODEGUERO', 'VIEWER'];

const disabledCapabilities = (): AssistantCapabilities => ({
    enabled: false, help: false, overview: false, inventory: false,
    invoiceRead: false, invoicePrepare: false, invoiceConfirm: false,
    extractionEnabled: false, executionEnabled: false,
    purchasePrepare: false,
    operations: false, dailyBrief: false, actionPrepare: false, actionConfirm: false,
    promotionManage: false, privateWhatsapp: false,
});

/** Revalidación también en servicios/worker: una llamada interna no hereda permisos. */
export async function getAssistantCapabilities(
    principal: AssistantPrincipal,
    db: PrismaClient = prisma,
): Promise<AssistantCapabilities> {
    if (!principal.tenantId || !principal.userId || !principal.role) {
        throw new AssistantAccessError(401, 'ASSISTANT_IDENTITY_REQUIRED', 'No se pudo identificar tu sesión.');
    }
    const current = await db.user.findFirst({
        where: { id: principal.userId, tenantId: principal.tenantId },
        select: { id: true, role: true, status: true },
    });
    if (!current || current.status !== 'ACTIVE' || current.role !== principal.role) {
        throw new AssistantAccessError(403, 'SESSION_REVOKED', 'Tu sesión cambió. Volvé a ingresar.');
    }
    const flags = getAssistantFlags();
    // No tocar tablas nuevas si está apagado: despliegue aditivo compatible.
    if (!flags.enabled || !ASSISTANT_KNOWN_ROLES.includes(current.role)) return disabledCapabilities();
    const config = await db.assistantTenantConfig.findUnique({ where: { tenantId: principal.tenantId } });
    if (!config?.enabled) return disabledCapabilities();
    const purchases = PURCHASE_WRITE_ROLES.includes(current.role);
    const extractionEnabled = flags.extractionEnabled && config.extractionEnabled;
    const executionEnabled = flags.executionEnabled && config.executionEnabled;
    const inventory = ASSISTANT_INVENTORY_ROLES.includes(current.role);
    const operations = Boolean(flags.operationsEnabled && config.operationsEnabled);
    const actionPrepare = Boolean(flags.actionsEnabled && config.actionsEnabled && SUPPLIER_RETURN_WRITE_ROLES.includes(current.role));
    const budgetManage = current.role === 'OWNER' || (current.role === 'ADMIN' && await canManageAssistantBudget(principal, db));
    return {
        accessScope: `${current.role}:budget:${budgetManage}`,
        budgetManage,
        enabled: true, help: true,
        overview: ASSISTANT_BUSINESS_SALES_ROLES.includes(current.role) || ASSISTANT_OWN_SALES_ROLES.includes(current.role) || inventory,
        inventory,
        invoiceRead: purchases,
        purchasePrepare: purchases,
        invoicePrepare: purchases && extractionEnabled,
        invoiceConfirm: purchases && executionEnabled,
        extractionEnabled: purchases && extractionEnabled,
        executionEnabled: purchases && executionEnabled,
        operations,
        cashReview: operations && canReadShiftReport(current.role),
        dailyBrief: operations && (ASSISTANT_BUSINESS_SALES_ROLES.includes(current.role) || ASSISTANT_OWN_SALES_ROLES.includes(current.role) || inventory),
        actionPrepare,
        actionConfirm: actionPrepare && executionEnabled,
        promotionManage: Boolean(flags.promotionsEnabled && config.promotionsEnabled && ['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(current.role)),
        privateWhatsapp: Boolean(flags.privateWhatsappEnabled && config.privateWhatsappEnabled),
    };
}

export async function assertAssistantAccess(
    principal: AssistantPrincipal,
    capability: keyof AssistantCapabilities,
    db: PrismaClient = prisma,
): Promise<void> {
    const capabilities = await getAssistantCapabilities(principal, db);
    if (!capabilities.enabled) {
        throw new AssistantAccessError(403, 'ASSISTANT_DISABLED', 'NortexGPT no está habilitado para este negocio.');
    }
    if (!capabilities[capability]) {
        throw new AssistantAccessError(403, 'ASSISTANT_FORBIDDEN', 'Tu rol no tiene acceso a esta función de NortexGPT.');
    }
}
