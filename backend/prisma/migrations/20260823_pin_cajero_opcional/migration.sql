-- NORTEX — El PIN del cajero deja de ser obligatorio para abrir la caja.
--
-- ESTRICTAMENTE ADITIVA: una columna booleana con DEFAULT. `db push` la aplica
-- sin riesgo de pérdida de datos, y todos los negocios existentes quedan con
-- `false` = "no exijo PIN", que es el comportamiento nuevo y sin fricción.
--
-- POR QUÉ EL DEFAULT ES false (y no true, que preservaría la conducta actual):
-- el PIN obligatorio era el problema, no el estado a preservar. El muro caía a
-- medio cobro —al apretar "Cobrar" por primera vez, con el cliente enfrente— y
-- para el dueño de una pulpería era puro trámite: la propia pantalla imprimía
-- el PIN inicial (1234) y además lo precargaba.
--
-- QUÉ NO SE PIERDE AL APAGARLO: la atribución de la VENTA nunca dependió del
-- PIN — `Sale.soldById` sale de `req.userId` (el JWT). Lo único que el PIN
-- aporta es distinguir cajeros cuando VARIOS COMPARTEN UN MISMO LOGIN; para eso
-- queda esta bandera, que el negocio prende cuando le sirve.
--
-- El PIN sigue existiendo en `Employee.pin`: lo usa el reloj de asistencia
-- (/api/hr/clock-in), donde el PIN SÍ es el mecanismo y no un trámite.

ALTER TABLE `Tenant`
  ADD COLUMN `requireCashierPin` BOOLEAN NOT NULL DEFAULT false;
