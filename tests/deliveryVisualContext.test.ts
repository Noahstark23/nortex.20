import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const manager = readFileSync(resolve(process.cwd(), 'components/DeliveryManager.tsx'), 'utf8');
const kanban = readFileSync(resolve(process.cwd(), 'components/delivery/DeliveryKanban.tsx'), 'utf8');
const segmentedControl = readFileSync(resolve(process.cwd(), 'components/ui/FluidSegmentedControl.tsx'), 'utf8');
const deliverySurface = `${manager}\n${kanban}\n${segmentedControl}`;

const deadAnimationClass = /(?:^|[\s"'`])(?:animate-in|fade-in(?:-[^\s"'`]+)?|slide-in-from-[^\s"'`]+|zoom-(?:in|out)(?:-[^\s"'`]+)?|fade-out(?:-[^\s"'`]+)?)(?=$|[\s"'`])/m;

describe('contexto visual de Entregas', () => {
    it('mantiene la torre de control, la carga y el modal en el contexto claro aprobado', () => {
        expect(manager.match(/nx-light-context/g)?.length).toBeGreaterThanOrEqual(2);
        expect(manager.match(/nx-workspace/g)?.length).toBeGreaterThanOrEqual(2);
        expect(manager).toContain('nx-light-context nx-workspace');
        expect(manager).not.toMatch(/\bnx-dark-context\b|\bnx-ticket-surface\b|\[color-scheme:dark\]/);
        expect(deliverySurface).not.toMatch(/(?:bg|text|border)-(?:blue|purple|violet|indigo|surface)-/);
    });

    it('usa un solo arbol: carrusel compacto en movil y cuatro columnas en escritorio', () => {
        expect(manager).toContain('<DeliveryKanban');
        expect(manager).not.toContain('COLUMNAS.map');
        expect(kanban).toContain('FluidSegmentedControl');
        expect(kanban).toContain('snap-x snap-mandatory');
        expect(kanban).toContain('overflow-x-auto');
        expect(kanban).toContain('basis-full');
        expect(kanban).toContain('lg:grid-cols-4');
        expect(kanban).not.toMatch(/\bgrid-cols-1\b|\bmd:grid-cols-2\b|\bmin-w-max\b|\bw-80\b/);
    });

    it('usa el viewport dinámico en el kanban', () => {
        expect(kanban).toContain('lg:max-h-[calc(100dvh-260px)]');
        expect(deliverySurface).not.toMatch(/\b100vh\b/);
    });

    it('no declara utilidades de animación ausentes del bundle', () => {
        expect(deliverySurface).not.toMatch(deadAnimationClass);
        expect(deliverySurface).not.toMatch(/\btransition-all\b/);
    });

    it('deja entregado fuera del gesto y separa asignar de despachar', () => {
        expect(kanban).toContain("pendiente: 'preparando'");
        expect(kanban).toContain("preparando: 'en_camino'");
        expect(kanban).not.toMatch(/(?:pendiente|preparando|en_camino):\s*'entregado'/);
        expect(manager).toContain('motorizadoId: motorizadoId || null');
        expect(manager).toContain('El despacho sigue siendo un paso separado.');
        expect(manager).not.toContain('pedido despachado');
    });
});
