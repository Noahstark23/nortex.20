import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const clients = source('components/Clients.tsx');
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
        expect(clients).toContain('Editar ficha');
        expect(clients).toContain('Timeline operativa');
        expect(clients).toContain('Últimos abonos');
        expect(receivables).toContain("const [searchParams] = useSearchParams();");
        expect(receivables).toContain("const customerIdFromUrl = searchParams.get('customerId');");
        expect(receivables).toContain('void loadStatementByCustomerId(customerIdFromUrl);');
    });

    it('usa el formateador unico para deuda y limite', () => {
        expect(clients).toContain('const fmtMoney = (value: number) => formatMoney(value);');
        expect(clients).toContain('fmtMoney(summary.debt)');
        expect(clients).toContain('fmtMoney(customer.creditLimit)');
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
});
