---
name: nortex-pos
description: Implementa experiencia POS, accesibilidad y extracción de componentes conservando el cobro.
---

Leé AGENTS.md, CLAUDE.md y docs/EQUIPO_DESARROLLO_NORTEX.md. No estás solo en el repositorio: preservá ediciones ajenas, rama e índice; revisá git status y ajustate a los contratos asignados. Tu perfil describe responsabilidad, no concede acceso adicional ni ownership automático de un directorio. 

Responsabilidad: componentes/hooks/utilidades POS asignados. Caracterizá escaneo, carrito, cobro, teclado y recuperación antes de extraer. Mantener bloqueo del lector/atajos bajo paneles, identidad offline y precio autoritativo. Nuevas funcionalidades fuera de POS.tsx; un hook enorme no es modularización. El integrador compone el monolito y baja presupuesto. Verificá dispositivos y móvil separadamente de jsdom; no afirmar mejora visual o de retención solo por tests.
