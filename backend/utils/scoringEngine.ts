// backend/utils/scoringEngine.ts

export const calculateCreditScore = async (prisma: any, tenantId: string) => {
  // 1. DATA FETCHING
  const now = new Date();
  const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));

  // Obtener Tenant (Liquidez)
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  
  // Obtener Ventas últimos 30 días (Flujo de Caja)
  const sales = await prisma.sale.findMany({
    where: {
      tenantId,
      date: { gte: thirtyDaysAgo } // Asumiendo que Prisma mapea 'date' correctamente
    }
  });

  // Obtener Inventario (Activos)
  const products = await prisma.product.findMany({ where: { tenantId } });

  // 2. CÁLCULO DE MÉTRICAS BASE

  // A. Liquidez (Cash is King)
  const walletBalance = Number(tenant.walletBalance || 0);
  
  // B. Valor del Inventario (Estimado al 70% del precio de venta como costo conservador si no hay historial de compras)
  const inventoryValue = products.reduce((acc: number, p: any) => acc + (Number(p.price) * Number(p.stock) * 0.7), 0);
  
  // C. Ventas Totales y Promedio Diario
  const totalSales = sales.reduce((acc: number, s: any) => acc + Number(s.total), 0);
  const dailyAverageSales = totalSales / 30;

  // D. Consistencia (Desviación Estándar)
  // Agrupar ventas por día
  const salesByDay: Record<string, number> = {};
  sales.forEach((s: any) => {
    const day = new Date(s.date).toISOString().split('T')[0]; // YYYY-MM-DD
    salesByDay[day] = (salesByDay[day] || 0) + Number(s.total);
  });
  
  const dailyValues = Object.values(salesByDay);
  const n = 30; // Usamos 30 días fijos para penalizar días de cero venta
  // Rellenar días con cero
  const zeroDays = n - dailyValues.length;
  for(let i=0; i<zeroDays; i++) dailyValues.push(0);

  const mean = dailyAverageSales;
  const variance = dailyValues.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  // 3. FÓRMULA DE SCORING (NORTEX FICO)
  
  // Factor 1: Liquidez (350 pts max). 
  // Regla: Tener en caja al menos 10 días de ventas promedio otorga puntaje máximo.
  const liquidityTarget = dailyAverageSales * 10;
  let liquidityScore = 0;
  if (liquidityTarget > 0) {
    liquidityScore = Math.min((walletBalance / liquidityTarget) * 350, 350);
  } else if (walletBalance > 1000) {
    liquidityScore = 200; // Puntos base si hay caja pero no ventas
  }

  // Factor 2: Consistencia/Volatilidad (300 pts max).
  // Menor volatilidad = Mayor puntaje. Coeficiente de variación.
  let consistencyScore = 0;
  if (mean > 0) {
    const cv = stdDev / mean; // Coeficiente de variación
    // Si CV es 0 (ventas idénticas todos los días) -> 300 pts.
    // Si CV es > 1 (muy volátil) -> tiende a 0.
    consistencyScore = Math.max(300 - (cv * 200), 50);
  }

  // Factor 3: Cobertura de Activos (200 pts max).
  // El inventario debe cubrir al menos 1 mes de ventas futuras.
  let assetScore = 0;
  if (totalSales > 0) {
      assetScore = Math.min((inventoryValue / totalSales) * 200, 200);
  } else if (inventoryValue > 5000) {
      assetScore = 100;
  }

  // Puntaje Base = 300
  let rawScore = 300 + liquidityScore + consistencyScore + assetScore;
  
  // Cap final
  rawScore = Math.min(Math.max(rawScore, 300), 850);
  const finalScore = Math.floor(rawScore);

  // 4. LÓGICA DE PRÉSTAMO
  // Monto máximo = 30% de las ventas mensuales promedio * Factor de Score
  const scoreFactor = (finalScore - 300) / 550; // 0 a 1
  const maxLoanAmount = Math.floor(totalSales * 0.30 * scoreFactor);

  // 5. DIAGNÓSTICO DEL CFO
  const tips = [];
  if (walletBalance < dailyAverageSales * 3) tips.push("⚠️ Liquidez Crítica: Mantén al menos 3 días de ventas en caja.");
  if (stdDev > mean * 0.8) tips.push("📉 Ventas Inestables: Tus ingresos diarios varían demasiado. Fideliza clientes.");
  if (inventoryValue > totalSales * 3) tips.push("📦 Exceso de Stock: Tienes capital dormido en almacén. Haz promociones.");
  if (tips.length === 0 && finalScore > 700) tips.push("🚀 Salud Financiera Óptima. Calificas para expansión.");

  return {
    score: finalScore,
    metrics: {
      liquidity: liquidityScore,
      consistency: consistencyScore,
      assets: assetScore
    },
    financials: {
      walletBalance,
      inventoryValue,
      monthlySales: totalSales
    },
    maxLoanAmount,
    tips
  };
};