import { Resend } from 'resend';

let resendClient: Resend | null = null;

if (process.env.RESEND_API_KEY) {
  resendClient = new Resend(process.env.RESEND_API_KEY);
  console.log('✅ Resend email service initialized');
} else {
  console.log('⚠️ RESEND_API_KEY not set — emails will be logged to console');
}

const FROM_EMAIL = process.env.EMAIL_FROM || 'Nortex <onboarding@resend.dev>';

// ============================================================================
// Plantilla base de marca (mismo look del email de reset) — un solo lugar
// para el shell HTML; cada email pone título, cuerpo y CTA.
// ============================================================================
function nortexEmailShell(opts: {
  heading: string;
  bodyHtml: string;      // HTML ya escapado/controlado por NOSOTROS (nunca input de usuario crudo)
  ctaText?: string;
  ctaUrl?: string;
  footnote?: string;
}): string {
  const cta = opts.ctaText && opts.ctaUrl
    ? `<a href="${opts.ctaUrl}" style="display:inline-block;background:#10b981;color:#0a0f1c;font-weight:bold;font-size:14px;padding:12px 32px;border-radius:8px;text-decoration:none;margin-bottom:8px;">${opts.ctaText}</a>`
    : '';
  const footnote = opts.footnote
    ? `<p style="color:#64748b;font-size:12px;margin:24px 0 0;line-height:1.5;">${opts.footnote}</p>`
    : '';
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0a0f1c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-block;width:48px;height:48px;background:#10b981;border-radius:12px;line-height:48px;text-align:center;">
        <span style="color:#0a0f1c;font-weight:bold;font-size:24px;">N</span>
      </div>
      <h1 style="color:#fff;font-size:20px;margin:12px 0 0;letter-spacing:2px;font-family:monospace;">NORTEX</h1>
    </div>
    <div style="background:#111827;border:1px solid #1f2937;border-radius:16px;padding:32px;text-align:center;">
      <h2 style="color:#fff;font-size:18px;margin:0 0 8px;">${opts.heading}</h2>
      <div style="color:#94a3b8;font-size:14px;margin:0 0 24px;line-height:1.6;text-align:left;">
        ${opts.bodyHtml}
      </div>
      ${cta}
      ${footnote}
    </div>
    <p style="color:#475569;font-size:11px;text-align:center;margin-top:24px;">
      © ${new Date().getFullYear()} Nortex — somosnortex.com · <a href="https://wa.me/50576644030" style="color:#475569;">WhatsApp +505 7664-4030</a>
    </p>
  </div>
</body>
</html>`;
}

// Escape mínimo para interpolar nombres elegidos por el usuario dentro del HTML.
function esc(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function deliver(to: string, subject: string, html: string): Promise<boolean> {
  if (!resendClient) {
    console.log(`📧 [DEV] Email "${subject}" para ${to} (RESEND_API_KEY no seteada)`);
    return false;
  }
  try {
    await resendClient.emails.send({ from: FROM_EMAIL, to, subject, html });
    console.log(`✅ Email "${subject}" enviado a ${to}`);
    return true;
  } catch (error) {
    console.error(`❌ Error enviando email "${subject}" a ${to}:`, error);
    return false;
  }
}

/**
 * Email de bienvenida al registrarse (retención R1). Incluye el PIN 1234 de
 * apertura de caja — eso permitió quitar el modal-peaje del registro y llevar
 * al usuario directo al panel. Fire-and-forget: NUNCA bloquea el registro.
 */
export async function sendWelcomeEmail(to: string, businessName: string, pin: string): Promise<boolean> {
  const baseUrl = process.env.FRONTEND_URL || 'https://somosnortex.com';
  return deliver(to, `Bienvenido a Nortex — tu prueba de 30 días ya empezó 🎉`, nortexEmailShell({
    heading: `¡Bienvenido, ${esc(businessName)}!`,
    bodyHtml: `
      <p>Tu cuenta ya está lista y tenés <strong style="color:#fff;">30 días gratis</strong> con todo incluido. Sin tarjeta, cancelás cuando querás.</p>
      <p>Para arrancar hoy mismo:</p>
      <ol style="padding-left:18px;margin:8px 0;">
        <li>Cargá tu primer producto (o usá el <strong style="color:#fff;">catálogo de ejemplo</strong> de tu giro, listo en un click).</li>
        <li>Hacé tu primera venta en el POS.</li>
        <li>Mirá tu caja del día en el panel.</li>
      </ol>
      <p>Tu PIN de apertura de caja es <strong style="color:#fff;font-family:monospace;font-size:16px;">${esc(pin)}</strong> (lo cambiás en Mi Equipo cuando querás).</p>`,
    ctaText: 'Entrar a mi panel',
    ctaUrl: `${baseUrl}/app/dashboard?welcome=1`,
    footnote: '¿Trabado con algo? Respondé este correo o escribinos por WhatsApp — te acompañamos el primer día.',
  }));
}

/**
 * Emails del ciclo de vida del trial (retención R1). El contenido vive acá;
 * la decisión de CUÁNDO mandarlos vive en services/lifecycleEmails.ts.
 */
export async function sendLifecycleEmail(
  to: string,
  kind: 'EMAIL_TRIAL_NOPRODUCT' | 'EMAIL_TRIAL_NOSALE' | 'EMAIL_TRIAL_ENDING' | 'EMAIL_TRIAL_EXPIRED',
  businessName: string,
  daysLeft?: number,
): Promise<boolean> {
  const baseUrl = process.env.FRONTEND_URL || 'https://somosnortex.com';
  const name = esc(businessName);
  switch (kind) {
    case 'EMAIL_TRIAL_NOPRODUCT':
      return deliver(to, 'Tu inventario te espera — cargalo en 3 minutos', nortexEmailShell({
        heading: `${name}, te falta el primer paso`,
        bodyHtml: `
          <p>Vimos que todavía no cargaste ningún producto. Sin productos, el sistema no puede venderte nada 😅.</p>
          <p>Tenés dos caminos, los dos rápidos:</p>
          <ul style="padding-left:18px;margin:8px 0;">
            <li><strong style="color:#fff;">Catálogo de ejemplo de tu giro</strong> — un click y quedás con productos reales de tu rubro para probar.</li>
            <li><strong style="color:#fff;">Tu primer producto real</strong> — nombre, precio y stock. 30 segundos.</li>
          </ul>`,
        ctaText: 'Cargar mi inventario',
        ctaUrl: `${baseUrl}/app/inventory?tour=inv`,
        footnote: '¿Muchos productos? Contestá este correo y te ayudamos a importarlos desde Excel.',
      }));
    case 'EMAIL_TRIAL_NOSALE':
      return deliver(to, 'Hacé tu primera venta hoy — toma 30 segundos', nortexEmailShell({
        heading: `${name}, probá cobrar una venta`,
        bodyHtml: `
          <p>Ya tenés la cuenta, pero todavía no registraste ninguna venta. La primera venta es donde Nortex hace click: el ticket, la caja y el inventario se mueven solos.</p>
          <p>Abrí el POS, buscá un producto, cobrá en efectivo. Eso es todo.</p>`,
        ctaText: 'Ir al punto de venta',
        ctaUrl: `${baseUrl}/app/pos?tour=pos`,
        footnote: 'Si algo no te cuadra del POS, escribinos por WhatsApp y lo vemos juntos en 5 minutos.',
      }));
    case 'EMAIL_TRIAL_ENDING':
      return deliver(to, `Tu prueba gratis termina en ${daysLeft ?? 3} días`, nortexEmailShell({
        heading: `${name}, quedan ${daysLeft ?? 3} días de prueba`,
        bodyHtml: `
          <p>Tu período gratis está por terminar. Para no perder el ritmo, activá tu plan desde el panel: <strong style="color:#fff;">$20 al mes</strong>, todo incluido, usuarios y sucursales sin límite.</p>
          <p>Y tranquilo: aunque se venza, <strong style="color:#fff;">nunca te bloqueamos el POS ni tus datos</strong> — podés seguir vendiendo mientras decidís.</p>`,
        ctaText: 'Activar mi plan',
        ctaUrl: `${baseUrl}/app/billing`,
        footnote: '¿Dudas del precio o del plan? Respondé este correo y hablamos.',
      }));
    case 'EMAIL_TRIAL_EXPIRED':
      return deliver(to, 'Tu prueba venció — pero seguís vendiendo', nortexEmailShell({
        heading: `${name}, tu prueba terminó`,
        bodyHtml: `
          <p>Se cumplieron los 30 días. <strong style="color:#fff;">Tu POS sigue funcionando y tus datos siguen siendo tuyos</strong> — no bloqueamos el negocio de nadie.</p>
          <p>Para recuperar los reportes, exportes y el resto de módulos, activá tu plan: $20 al mes, sin contrato.</p>`,
        ctaText: 'Reactivar todo',
        ctaUrl: `${baseUrl}/app/billing`,
        footnote: 'Si Nortex no fue para vos, contanos por qué respondiendo este correo — nos sirve de verdad.',
      }));
  }
}

/**
 * Envía email de recuperación de contraseña.
 */
export async function sendPasswordResetEmail(
  to: string,
  resetLink: string,
  userName: string
): Promise<boolean> {
  if (!resendClient) {
    console.log(`📧 [DEV] Reset link para ${to}: ${resetLink}`);
    return false;
  }

  try {
    await resendClient.emails.send({
      from: FROM_EMAIL,
      to,
      subject: 'Recupera tu contraseña — Nortex',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0a0f1c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 20px;">
    <!-- Logo -->
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-block;width:48px;height:48px;background:#10b981;border-radius:12px;line-height:48px;text-align:center;">
        <span style="color:#0a0f1c;font-weight:bold;font-size:24px;">N</span>
      </div>
      <h1 style="color:#fff;font-size:20px;margin:12px 0 0;letter-spacing:2px;font-family:monospace;">NORTEX</h1>
    </div>

    <!-- Card -->
    <div style="background:#111827;border:1px solid #1f2937;border-radius:16px;padding:32px;text-align:center;">
      <h2 style="color:#fff;font-size:18px;margin:0 0 8px;">Recuperar Contraseña</h2>
      <p style="color:#94a3b8;font-size:14px;margin:0 0 24px;line-height:1.5;">
        Hola <strong style="color:#fff;">${userName}</strong>, recibimos una solicitud para restablecer tu contraseña.
      </p>

      <!-- Button -->
      <a href="${resetLink}" style="display:inline-block;background:#10b981;color:#0a0f1c;font-weight:bold;font-size:14px;padding:12px 32px;border-radius:8px;text-decoration:none;margin-bottom:24px;">
        Restablecer Contraseña
      </a>

      <p style="color:#64748b;font-size:12px;margin:24px 0 0;line-height:1.5;">
        Este link expira en <strong style="color:#94a3b8;">1 hora</strong>.<br>
        Si no solicitaste esto, ignora este email.
      </p>
    </div>

    <!-- Footer -->
    <p style="color:#475569;font-size:11px;text-align:center;margin-top:24px;">
      © ${new Date().getFullYear()} Nortex — somosnortex.com
    </p>
  </div>
</body>
</html>
            `,
    });
    console.log(`✅ Email de reset enviado a ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Error enviando email:', error);
    return false;
  }
}

/**
 * Aviso al operador de que entró un pago manual por revisar.
 *
 * En Nicaragua el rail de cobro NO es Stripe (no soporta el país como comercio):
 * es depósito con comprobante y activación a mano. Sin este aviso, el cliente
 * transfiere y la suscripción se queda esperando a que alguien abra el panel de
 * administración por casualidad — la peor experiencia posible justo en el momento
 * en que decidió pagar.
 *
 * Destino: BILLING_ALERT_EMAIL (o ADMIN_EMAIL). Si no hay ninguno configurado no
 * se envía nada y se deja rastro en el log. Fire-and-forget: NUNCA bloquea ni
 * hace fallar el reporte de pago del cliente.
 */
export async function sendManualPaymentAlert(params: {
  businessName: string;
  amount: string;
  currency: string;
  bank: string;
  referenceNumber: string;
  hasProof: boolean;
}): Promise<boolean> {
  const to = process.env.BILLING_ALERT_EMAIL || process.env.ADMIN_EMAIL;
  if (!to) {
    console.log(`💸 Pago manual reportado por ${params.businessName} — sin BILLING_ALERT_EMAIL configurado, no se envió aviso.`);
    return false;
  }
  const baseUrl = process.env.FRONTEND_URL || 'https://somosnortex.com';
  const simbolo = params.currency === 'USD' ? '$' : 'C$';
  return deliver(
    to,
    `Pago reportado: ${params.businessName} — ${simbolo}${params.amount}`,
    nortexEmailShell({
      heading: 'Entró un pago por revisar',
      bodyHtml: `
        <p style="margin:0 0 16px;color:#cbd5e1;">
          <strong style="color:#f1f5f9;">${esc(params.businessName)}</strong> reportó un pago de
          <strong style="color:#f1f5f9;">${simbolo}${esc(params.amount)} ${esc(params.currency)}</strong>.
        </p>
        <p style="margin:0 0 8px;color:#94a3b8;">Banco: <strong style="color:#cbd5e1;">${esc(params.bank)}</strong></p>
        <p style="margin:0 0 8px;color:#94a3b8;">Referencia: <strong style="color:#cbd5e1;">${esc(params.referenceNumber)}</strong></p>
        <p style="margin:0 0 16px;color:${params.hasProof ? '#94a3b8' : '#fbbf24'};">
          Comprobante: <strong>${params.hasProof ? 'adjunto' : 'NO adjunto — confirmar con el banco'}</strong>
        </p>
        <p style="margin:0;color:#64748b;font-size:13px;">
          La suscripción NO se activa sola: hay que aprobarlo en el panel.
        </p>`,
      ctaText: 'Revisar en el panel',
      ctaUrl: `${baseUrl}/admin`,
    }),
  );
}
