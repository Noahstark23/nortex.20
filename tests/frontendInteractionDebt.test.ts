import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Trinquete del primer ciclo de auditoría Apple/Spatial Counter.
 *
 * Estos máximos describen deuda existente, no objetivos aceptables. Solo
 * pueden bajar. Un control nuevo nace con `nx-fluid-press` o con un spread
 * `useFluidPress(...).bind`; nunca se aumenta el presupuesto para pasar CI.
 */
const BUDGET = {
    'components/Layout.tsx': { buttonsWithoutPress: 0, transitionAll: 0 },
    // POS conserva su propio presupuesto canónico de tamaño y pruebas de
    // conducta. No se lee como string acá: presupuestoPos.test.ts impide crear
    // acoplamientos nuevos que vuelvan más difícil extraer el monolito.
    'components/CashRegisters.tsx': { buttonsWithoutPress: 0, transitionAll: 0 },
    'components/Inventory.tsx': { buttonsWithoutPress: 0, transitionAll: 0 },
    'components/Purchases.tsx': { buttonsWithoutPress: 0, transitionAll: 0 },
    'components/Sales.tsx': { buttonsWithoutPress: 0, transitionAll: 0 },
    'components/DeliveryManager.tsx': { buttonsWithoutPress: 0, transitionAll: 0 },
    'components/delivery/DeliveryKanban.tsx': { buttonsWithoutPress: 0, transitionAll: 0 },
    'components/DriverView.tsx': { buttonsWithoutPress: 0, transitionAll: 0 },
    'components/ui/FluidSegmentedControl.tsx': { buttonsWithoutPress: 0, transitionAll: 0 },
    'components/Dashboard.tsx': { buttonsWithoutPress: 0, transitionAll: 0 },
    'components/AccountsReceivable.tsx': { buttonsWithoutPress: 0, transitionAll: 0 },
} as const;

const countNativeButtonsWithoutPress = (file: string, source: string): number => {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let missing = 0;

    const visit = (node: ts.Node) => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
            && node.tagName.getText(tree) === 'button') {
            const attributes = node.attributes.getText(tree);
            const hasCssPrimitive = attributes.includes('nx-fluid-press');
            const hasEngineBinding = /\.\.\.[A-Za-z0-9_]+\.bind/.test(attributes);
            if (!hasCssPrimitive && !hasEngineBinding) missing += 1;
        }
        ts.forEachChild(node, visit);
    };

    visit(tree);
    return missing;
};

describe('presupuesto de deuda de interacción frontend', () => {
    for (const [file, budget] of Object.entries(BUDGET)) {
        it(`${file} no aumenta controles sin press ni transition-all`, () => {
            const source = readFileSync(resolve(ROOT, file), 'utf8');
            const buttonsWithoutPress = countNativeButtonsWithoutPress(file, source);
            const transitionAll = source.match(/\btransition-all\b/g)?.length ?? 0;
            const isolatedActiveScale = source.match(/\bactive:scale(?:-|\[)/g)?.length ?? 0;

            expect(
                buttonsWithoutPress,
                `Bajá buttonsWithoutPress para ${file}; nunca subás el presupuesto ${budget.buttonsWithoutPress}.`,
            ).toBeLessThanOrEqual(budget.buttonsWithoutPress);
            expect(
                transitionAll,
                `Bajá transitionAll para ${file}; nunca subás el presupuesto ${budget.transitionAll}.`,
            ).toBeLessThanOrEqual(budget.transitionAll);
            expect(isolatedActiveScale, 'Usá nx-fluid-press o nx-fluid-engine.').toBe(0);
        });
    }
});
