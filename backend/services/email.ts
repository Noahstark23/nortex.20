import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

const FROM_EMAIL = process.env.EMAIL_FROM || 'Nortex <onboarding@resend.dev>';

/**
 * Envía email de recuperación de contraseña.
 */
export async function sendPasswordResetEmail(
    to: string,
    resetLink: string,
    userName: string
): Promise<boolean> {
    if (!resend) {
        console.warn('⚠️ RESEND_API_KEY no configurada. Email no enviado.');
        console.log(`📧 [DEV] Reset link para ${to}: ${resetLink}`);
        return false;
    }

    try {
        await resend.emails.send({
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
