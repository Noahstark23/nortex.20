import { describe, expect, it } from 'vitest';
import { buildNavigation } from '../utils/navigation';

describe('navegación de balanzas', () => {
    it('la muestra a dueño y admin, incluida la miscelánea en modo simple', () => {
        const owner = buildNavigation({ tenantType: 'MISCELANEA', role: 'OWNER', simple: true });
        const admin = buildNavigation({ tenantType: 'RETAIL', role: 'ADMIN', simple: false });

        expect(owner.primary.map(item => item.path)).toContain('/app/scales');
        expect(admin.primary.map(item => item.path)).toContain('/app/scales');
    });

    it('no expone la configuración a roles operativos', () => {
        for (const role of ['CASHIER', 'MANAGER', 'VENDEDOR']) {
            const navigation = buildNavigation({ tenantType: 'MISCELANEA', role, simple: false });
            expect([...navigation.primary, ...navigation.more].map(item => item.path)).not.toContain('/app/scales');
        }
    });
});
