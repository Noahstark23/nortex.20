import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
    PURCHASE_IVA_RATE,
    PURCHASE_NO_TAX_REASONS,
    PURCHASE_TAX_SIN_TRASLADO,
    PURCHASE_TAX_TRASLADADO,
    PURCHASE_TAX_TREATMENTS,
    isPurchaseNoTaxReason,
    isPurchaseTaxTreatment,
    normalizeStoredPurchaseNoTaxReason,
    normalizeStoredPurchaseTaxTreatment,
    purchaseLineTax,
    purchaseTaxTreatmentIssue,
    purchaseTransfersTax,
    suggestPurchaseTaxTreatment,
} from '../utils/purchaseTaxTreatment';
import {
    PURCHASE_NO_TAX_REASON_LABELS,
    PURCHASE_TAX_TREATMENT_LABELS,
} from '../utils/purchaseTaxTreatmentLabels';

describe('vocabulario de traslación del IVA en compras', () => {
    it('expone exactamente dos tratamientos', () => {
        expect(PURCHASE_TAX_TREATMENTS).toEqual(['IVA_TRASLADADO', 'SIN_TRASLADO']);
    });

    it('expone los cuatro motivos de no traslación', () => {
        expect(PURCHASE_NO_TAX_REASONS).toEqual([
            'PROVEEDOR_CUOTA_FIJA',
            'PROVEEDOR_NO_INSCRITO',
            'IMPORTACION_IVA_ADUANA',
            'EXONERACION_DOCUMENTADA',
        ]);
    });

    it('conserva la tasa de IVA en 15%', () => {
        expect(PURCHASE_IVA_RATE).toBe('0.15');
    });

    it('reconoce solo los tratamientos del vocabulario', () => {
        expect(isPurchaseTaxTreatment(PURCHASE_TAX_TRASLADADO)).toBe(true);
        expect(isPurchaseTaxTreatment(PURCHASE_TAX_SIN_TRASLADO)).toBe(true);
        expect(isPurchaseTaxTreatment('SIN_IVA')).toBe(false);
        expect(isPurchaseTaxTreatment('')).toBe(false);
        expect(isPurchaseTaxTreatment(null)).toBe(false);
        expect(isPurchaseTaxTreatment(undefined)).toBe(false);
    });

    it('reconoce solo los motivos del vocabulario', () => {
        expect(isPurchaseNoTaxReason('PROVEEDOR_CUOTA_FIJA')).toBe(true);
        expect(isPurchaseNoTaxReason('EXONERACION_DOCUMENTADA')).toBe(true);
        expect(isPurchaseNoTaxReason('PORQUE_SI')).toBe(false);
        expect(isPurchaseNoTaxReason(null)).toBe(false);
        expect(isPurchaseNoTaxReason(undefined)).toBe(false);
    });
});

describe('lectura de filas almacenadas', () => {
    it('conserva SIN_TRASLADO cuando así se registró', () => {
        expect(normalizeStoredPurchaseTaxTreatment('SIN_TRASLADO')).toBe(PURCHASE_TAX_SIN_TRASLADO);
    });

    it.each([
        ['IVA_TRASLADADO'],
        ['GENERAL'],
        ['sin_traslado'],
        [''],
        [null],
        [undefined],
        [0],
    ])('interpreta %s como IVA trasladado, que es lo que se le cobró al histórico', (stored) => {
        // Fail-closed hacia el histórico: una fila legacy o corrupta NO puede
        // volverse "sin IVA" y borrar un crédito fiscal que sí se acreditó.
        expect(normalizeStoredPurchaseTaxTreatment(stored)).toBe(PURCHASE_TAX_TRASLADADO);
    });

    it('descarta un motivo fuera del vocabulario', () => {
        expect(normalizeStoredPurchaseNoTaxReason('PROVEEDOR_NO_INSCRITO')).toBe('PROVEEDOR_NO_INSCRITO');
        expect(normalizeStoredPurchaseNoTaxReason('OTRO')).toBeNull();
        expect(normalizeStoredPurchaseNoTaxReason(null)).toBeNull();
    });

    it('solo IVA_TRASLADADO traslada impuesto', () => {
        expect(purchaseTransfersTax(PURCHASE_TAX_TRASLADADO)).toBe(true);
        expect(purchaseTransfersTax(PURCHASE_TAX_SIN_TRASLADO)).toBe(false);
        expect(purchaseTransfersTax('cualquier cosa')).toBe(true);
    });
});

describe('IVA de una línea', () => {
    it('cobra 15% solo con documento que traslada y producto gravado', () => {
        expect(purchaseLineTax('1000.00', true, PURCHASE_TAX_TRASLADADO).toFixed(2)).toBe('150.00');
    });

    it.each([
        [true, PURCHASE_TAX_SIN_TRASLADO, 'documento sin traslación'],
        [false, PURCHASE_TAX_TRASLADADO, 'producto exento'],
        [false, PURCHASE_TAX_SIN_TRASLADO, 'ambos ejes en falso'],
    ])('da cero con %s / %s (%s)', (taxable, treatment, _motivo) => {
        expect(purchaseLineTax('1000.00', taxable, treatment).isZero()).toBe(true);
    });

    it('redondea HALF_UP a centavos', () => {
        expect(purchaseLineTax('0.10', true, PURCHASE_TAX_TRASLADADO).toFixed(2)).toBe('0.02');
        expect(purchaseLineTax('0.03', true, PURCHASE_TAX_TRASLADADO).toFixed(2)).toBe('0.00');
    });

    it('acepta una base cero', () => {
        expect(purchaseLineTax('0', true, PURCHASE_TAX_TRASLADADO).isZero()).toBe(true);
    });

    it('acepta un Decimal como base', () => {
        expect(purchaseLineTax(new Decimal('200'), true, PURCHASE_TAX_TRASLADADO).toFixed(2)).toBe('30.00');
    });

    it.each([
        ['-0.01'],
        ['NaN'],
        ['Infinity'],
    ])('rechaza una base inválida %s', (lineNet) => {
        expect(() => purchaseLineTax(lineNet, true, PURCHASE_TAX_TRASLADADO)).toThrow(
            'La base de la línea debe ser finita y no negativa',
        );
    });

    it('valida la base incluso cuando el impuesto sería cero', () => {
        // Una base negativa no puede colarse escondida detrás de un IVA cero.
        expect(() => purchaseLineTax('-1.00', false, PURCHASE_TAX_SIN_TRASLADO)).toThrow(
            'La base de la línea debe ser finita y no negativa',
        );
    });
});

describe('sugerencia a partir de la categoría fiscal del proveedor', () => {
    it('propone no traslación para un proveedor de cuota fija', () => {
        expect(suggestPurchaseTaxTreatment('CUOTA_FIJA')).toEqual({
            treatment: PURCHASE_TAX_SIN_TRASLADO,
            reason: 'PROVEEDOR_CUOTA_FIJA',
        });
    });

    it('propone exoneración documentada para un proveedor exento', () => {
        expect(suggestPurchaseTaxTreatment('EXEMPT')).toEqual({
            treatment: PURCHASE_TAX_SIN_TRASLADO,
            reason: 'EXONERACION_DOCUMENTADA',
        });
    });

    it('tolera espacios y minúsculas, porque el campo es texto libre', () => {
        expect(suggestPurchaseTaxTreatment('  cuota_fija ').treatment).toBe(PURCHASE_TAX_SIN_TRASLADO);
    });

    it.each([
        ['GENERAL'],
        ['OTHER'],
        ['ferretería'],
        [''],
        [null],
        [undefined],
    ])('propone traslación normal para %s', (category) => {
        expect(suggestPurchaseTaxTreatment(category)).toEqual({
            treatment: PURCHASE_TAX_TRASLADADO,
            reason: null,
        });
    });
});

describe('coherencia del par tratamiento/motivo', () => {
    it('acepta traslación normal sin motivo', () => {
        expect(purchaseTaxTreatmentIssue(PURCHASE_TAX_TRASLADADO, null)).toBeNull();
        expect(purchaseTaxTreatmentIssue(PURCHASE_TAX_TRASLADADO, undefined)).toBeNull();
    });

    it('rechaza un motivo sobre una factura que sí traslada', () => {
        expect(purchaseTaxTreatmentIssue(PURCHASE_TAX_TRASLADADO, 'PROVEEDOR_CUOTA_FIJA'))
            .toBe('REASON_NOT_APPLICABLE');
    });

    it('exige motivo cuando la factura no trae IVA', () => {
        expect(purchaseTaxTreatmentIssue(PURCHASE_TAX_SIN_TRASLADO, null)).toBe('REASON_REQUIRED');
        expect(purchaseTaxTreatmentIssue(PURCHASE_TAX_SIN_TRASLADO, undefined)).toBe('REASON_REQUIRED');
    });

    it('rechaza un motivo fuera del vocabulario', () => {
        expect(purchaseTaxTreatmentIssue(PURCHASE_TAX_SIN_TRASLADO, 'PORQUE_SI')).toBe('REASON_REQUIRED');
        expect(purchaseTaxTreatmentIssue(PURCHASE_TAX_SIN_TRASLADO, '')).toBe('REASON_REQUIRED');
    });

    it('acepta cada motivo válido sin traslación', () => {
        for (const reason of PURCHASE_NO_TAX_REASONS) {
            expect(purchaseTaxTreatmentIssue(PURCHASE_TAX_SIN_TRASLADO, reason)).toBeNull();
        }
    });
});

describe('etiquetas de presentación', () => {
    // No se asevera la redacción: eso solo congelaría el texto. Se asevera que
    // TODO el vocabulario tenga etiqueta, que es lo que rompe la UI si falta.
    it('cubre cada tratamiento con una etiqueta no vacía', () => {
        for (const treatment of PURCHASE_TAX_TREATMENTS) {
            expect(PURCHASE_TAX_TREATMENT_LABELS[treatment]?.trim()).toBeTruthy();
        }
    });

    it('cubre cada motivo con una etiqueta no vacía', () => {
        for (const reason of PURCHASE_NO_TAX_REASONS) {
            expect(PURCHASE_NO_TAX_REASON_LABELS[reason]?.trim()).toBeTruthy();
        }
    });
});
