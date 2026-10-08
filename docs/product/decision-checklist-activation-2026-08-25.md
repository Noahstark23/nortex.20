# Decisión pendiente — checklist de activación

Fecha: 2026-08-25

## Problema verificado

En una cuenta nueva `PULPERIA`, `GET /api/onboarding` propone cinco hitos:

1. producto por peso o medida;
2. presentación por empaque o saco;
3. lote y vencimiento;
4. primera venta;
5. cliente.

El estado persiste bien y se deriva de datos reales. El problema no es técnico:
tres de los primeros cinco hitos son funciones avanzadas de inventario, mientras
que una cuenta nueva necesita llegar a su primera venta. Un catálogo con productos
contados tampoco completa el hito `product`, porque hoy ese hito significa
“producto por peso o medida”.

## Decisión que falta

Definir si los hitos de peso, empaque y lote:

- salen del checklist inicial y pasan a “Siguiente nivel”;
- aparecen solo después de la primera venta; o
- se muestran únicamente para giros que realmente los necesitan.

## Propuesta recomendada para validar

Separar dos recorridos:

- **Activación:** crear producto → abrir caja en contexto → cobrar → venta completada.
- **Madurez operativa:** peso/medida, empaques, lotes, vencimientos y configuración fiscal según el giro.

No se cambió la lógica de `/api/onboarding` en este trabajo. Requiere aprobación de
Producto porque modifica qué significa “configuración completa” y las métricas
históricas asociadas.

