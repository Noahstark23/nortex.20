import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const clients = source('components/Clients.tsx');
const customer360 = source('components/customer/Customer360Detail.tsx');
const customerHubUi = `${clients}\n${customer360}`;
const receivables = source('components/AccountsReceivable.tsx');
const server = source('backend/server.ts');

describe('modulo de clientes y salto a cobranza', () => {
    it('consulta el customer hub en el backend con filtros reales', () => {
        expect(clients).toContain("if (searchTerm.trim()) params.set('search', searchTerm.trim());");
        expect(clients).toContain("if (segment) params.set('segment', segment);");
        expect(clients).toContain("if (sellerFilter) params.set('sellerId', sellerFilter);");
        expect(clients).toContain("params.set('limit', '80');");
        expect(clients).toContain("authFetch(`/api/customers/hub?${params.toString()}`)");
    });

    it('carga el detalle del cliente en el hub y mantiene acceso directo al estado de cuenta por URL', () => {
        expect(clients).toContain("authFetch(`/api/customers/${customerId}/hub`)");
        expect(clients).toContain("navigate(`/app/receivables?customerId=${detail.profile.id}`)");
        expect(customerHubUi).toContain('Enviar estado');
        expect(customerHubUi).toContain('Editar ficha');
        expect(customerHubUi).toContain('Actividad reciente');
        expect(customerHubUi).toContain('Registrar abono');
        expect(receivables).toContain("const [searchParams] = useSearchParams();");
        expect(receivables).toContain("const customerIdFromUrl = searchParams.get('customerId');");
        expect(receivables).toContain('void loadStatementByCustomerId(customerIdFromUrl);');
    });

    it('usa el formateador unico para deuda y limite', () => {
        expect(clients).toContain('const fmtMoney = (value: number) => formatMoney(value);');
        expect(clients).toContain('fmtMoney(summary.debt)');
        expect(customer360).toContain('money(detail.profile.creditLimit)');
    });

    it('separa la edición de identidad legal de los datos de contacto', () => {
        expect(clients).toContain("const CUSTOMER_IDENTITY_EDIT_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN']);");
        expect(clients).toContain('if (canWriteLegalIdentity) {');
        expect(clients).toContain('readOnly={!canEditIdentityFields}');
        expect(clients).toContain('Solo administración puede cambiarlos.');
    });

    it('reserva límite y asignación de cartera a controles administrativos', () => {
        expect(clients).toContain('allowCreditLimitInput: canManageControls');
        expect(clients).toContain('if (puedeAsignar) {');
        expect(clients).toContain('{canManageControls && (');
    });

    it('prioriza cartera critica antes de aplicar el limite del hub', () => {
        expect(server).toContain('function customerHubOrderBy(segment: string)');
        expect(server).toContain("orderBy: customerHubOrderBy(segment),");
        expect(server).toContain("{ currentDebt: 'desc' as const }");
    });

    it('muestra incobrable a super admin igual que al permiso real del backend', () => {
        expect(receivables).toContain("return r === 'OWNER' || r === 'ADMIN' || r === 'SUPER_ADMIN';");
        expect(receivables).toContain('{canWriteOff && (');
    });

    it('reemplaza alertas nativas de cobranza por toasts y modales del producto', () => {
        expect(receivables).toContain("const { toast, showToast, dismissToast } = useToast();");
        expect(receivables).toContain('<ToastViewport toast={toast} onDismiss={dismissToast} />');
        expect(receivables).toContain('setWriteoffDraft({ saleId, customerName, balance, reason: \'\' });');
        expect(receivables).not.toContain('alert(');
        expect(receivables).not.toContain('window.confirm(');
        expect(receivables).not.toContain('window.prompt(');
    });

    it('mantiene los diálogos de clientes dentro del sistema y sin APIs nativas', () => {
        expect(clients).toContain('useAccessibleDialog(');
        expect(clients).toContain('role="alertdialog"');
        expect(clients).toContain("event.key === 'Escape'");
        expect(clients).not.toContain('alert(');
        expect(clients).not.toContain('window.confirm(');
        expect(clients).not.toContain('window.prompt(');
    });
});
