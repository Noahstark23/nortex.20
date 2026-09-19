# Infraestructura de Marketing — Nortex (plan + construcción)

**Owner:** `marketing_lead` — **Workflow:** `marketing_campaign_v1` — **Modo:** `OFFLINE_PROPOSE_ONLY`, `AWAITING_APPROVAL`

Este documento resume la infraestructura **planificada y construida como borradores locales** por `marketing_lead`, `content_brand`, `seo_social_email`, `growth_analyst` y `legal_compliance`. No publica, no pauta, no envía.

## Plan

Ver detalle en `Developer/Nortex/control-plane/artifacts/marketing-infra-plan-2026-08-28.md`:

- **Objetivo:** que quien busque “sistema facturación Nicaragua” entienda en 60s el valor DGI+Kardex+Ley 185 y pruebe `/demo`.
- **Audiencia:** dueños PyME y admin en Nicaragua.
- **Canales:** SEO+Blog (landings `/`, `/ferreterias`, `/farmacias`, `/nicaragua`), social orgánico (FB/TikTok 2/sem), email onboarding 3 correos, demo `/demo`.
- **Límites:** sin publicación, sin compra, sin listas, presupuesto pendiente, gate `human_owner`.

## Construcción (borradores)

Ver `control-plane/artifacts/marketing-infra-construccion-2026-08-28.md`:

- **Contenido:** matriz 4 audiencias, hero gris cálido `#ececf0` (aprobado 2026-08-28), 4 posts blog, guion TikTok 30s, mapa claim→evidencia (`InvoiceTemplate.tsx`, `HRM.tsx`, etc.).
- **SEO:** titles/descriptions por ruta, canonical `somosnortex.com`, OG ya en `index.html`.
- **Social:** calendario 4 semanas, formatos 1:1/9:16, CTA `/demo`/`/register`.
- **Email:** D0/D2/D7 con consentimiento y salida 1 clic, sin envío.
- **Medición:** embudo `visitas→demo→registro→primera venta <24h→D7/D14`, baseline onboarding, experimento A/B hero gris cálido vs `#f5f5f7`.
- **Compliance:** disclosure “Capital en desarrollo” obligatorio, links privacidad/términos, bloqueos de claims no probados.

## Cómo ver/activar

Los artefactos son `internal_local_draft` en `artifacts/team/` (cuando se encole vía `nortex team-dispatch --workflow marketing_campaign_v1`). Para previsualizar la landing gris cálida: `http://127.0.0.1:4174/apple` (loop local).

## Siguiente paso

Un agente de mayor frontera presentará `campaign_approval_packet_draft` a `human_owner` para autorizar publicación/pauta. Hasta entonces, todo queda como borrador auditable.
