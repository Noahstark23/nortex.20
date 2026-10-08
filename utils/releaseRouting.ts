import { homePathFor, type UiMode } from './navigation';
import type { RegistrationIntent } from './publicActivation';

export function uiModeForNewTenant(tenantType: string): UiMode {
    return tenantType === 'LENDER' ? 'full' : 'simple';
}

export function postRegistrationDestination(input: {
    role: string;
    tenantType: string;
    intent?: RegistrationIntent | null;
}): string {
    const uiMode = uiModeForNewTenant(input.tenantType);
    if (input.tenantType === 'LENDER') return '/app/dashboard?welcome=1';
    if (input.intent) return '/app/pos?first_sale=1';

    const homePath = homePathFor(input.role, uiMode);
    return `${homePath}?welcome=1`;
}
