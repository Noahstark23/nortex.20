/** Suites obligatorias: no se acepta un verde producido por describe.skip. */
export const REQUIRED_INTEGRATION_SUITES = [
  'tests/journalSingleConnection.mysql.test.ts',
  'tests/whatsappIdentity.mysql.test.ts',
  'tests/cashCloseJournal.mysql.test.ts',
  'tests/posIntegrity.integration.test.ts',
  'tests/manualCashMovementVoid.integration.test.ts',
  'tests/customerFlow.integration.test.ts',
  'tests/hrAccess.integration.test.ts',
  'tests/productRefresh.integration.test.ts',
  'tests/fiscalFlow.integration.test.ts',
  'tests/inventoryAdjust.integration.test.ts',
  'tests/batchWarehouseManualMovements.test.ts',
  'tests/purchaseFlow.integration.test.ts',
  'tests/purchaseSalePrice.integration.test.ts',
  'tests/procurementPhaseOne.integration.test.ts',
  'tests/procurementPhaseTwo.integration.test.ts',
  'tests/procurementPhaseTwoB.integration.test.ts',
  'tests/returnIdempotency.integration.test.ts',
  'tests/stockCountWarehouse.integration.test.ts',
  'tests/delivery.mysql.integration.test.ts',
];

export function validateQualityDatabase(raw, acknowledgement) {
  if (acknowledgement !== 'disposable-database') throw new Error('Requiere una base descartable explícita.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Falta una URL MySQL de QA válida.'); }
  if (url.protocol !== 'mysql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || !/^\/nortex_(qa|quality|test)(?:_[a-z0-9_]+)?$/.test(url.pathname)) {
    throw new Error('La compuerta solo admite MySQL local y una base nortex_qa, nortex_quality o nortex_test.');
  }
  return url;
}

export function assertExecutedSuite(report, filename) {
  const matching = report?.testResults?.filter(result => result.name?.replaceAll('\\', '/').endsWith('/' + filename)) ?? [];
  if (report?.success !== true || matching.length !== 1) throw new Error(`No se ejecutó la suite requerida: ${filename}`);
  const suite = matching[0];
  if (suite.status !== 'passed' || !suite.assertionResults?.length
      || suite.assertionResults.some(test => test.status !== 'passed')) {
    throw new Error(`Suite incompleta, fallida u omitida: ${filename}`);
  }
  return suite.assertionResults.length;
}
