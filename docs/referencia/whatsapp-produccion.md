# WhatsApp en producción — salir del sandbox de Twilio

> Guía operativa (investigada el 2026-09-11 sobre documentación oficial de Twilio y Meta).
> **Estado actual**: `backend/.env` apunta al sandbox público de Twilio (`whatsapp:+14155238886`).
> El sandbox es solo para desarrollo: número compartido con miles de desarrolladores, exige que
> cada usuario mande `join <código>`, no tiene nombre de marca y no pasa por ninguna verificación
> de Meta. Antes de operar con usuarios reales hay que completar este onboarding.

---

## 1. Resumen del proceso

El flujo vigente de Twilio se llama **WhatsApp Self Sign-up** y es casi 100% self-service desde la
Console: el registro del número tarda **5-15 minutos** y el sender queda operativo de inmediato.
Las dos revisiones de Meta (display name y Business Verification) corren **después, en paralelo,
sin bloquear la operación**: sin verificar se puede operar con hasta **250 conversaciones iniciadas
por el negocio cada 24 hs** — y las respuestas a mensajes que inician los usuarios (el caso
principal del chatbot de CONSTRUCTA) **no consumen ese límite**.

Pagar Twilio no reemplaza nada de esto: la aprobación siempre la da Meta; Twilio intermedia el
trámite (crea la WABA — WhatsApp Business Account — en nombre de la empresa).

## 2. Requisitos previos (juntar antes de empezar)

1. **Cuenta Twilio upgradeada** (no trial): Console → Admin → Account billing.
2. **Cuenta personal de Facebook** de quien hace el trámite (el popup pide login).
3. **Meta Business Portfolio** (ex Business Manager): no hace falta tenerlo antes — el flujo lo
   crea en el momento. Si la empresa ya tiene uno (por ads), usarlo con rol de administrador.
4. **Un número de teléfono** que cumpla:
   - **NO estar registrado en WhatsApp** (ni app personal ni Business). Chequeo rápido:
     `https://wa.me/<numero>?text=hi` — si abre un chat, está tomado. Si es un número propio con
     WhatsApp activo, primero eliminar esa cuenta desde la app (Ajustes → Cuenta → Eliminar cuenta).
   - **Recibir SMS o llamada** para el código de verificación (no sirven IVR ni solo-salientes).
   - Opciones, de más a menos recomendada para CONSTRUCTA:
     1. **Chip argentino nuevo dedicado** que nunca haya tenido WhatsApp — número local, lo más
        profesional de cara a los responsables de obra.
     2. **Número US de Twilio** (~US$1.15/mes) — se activa en minutos, sin papeles.
     3. Número argentino de Twilio — existe, pero pide un *Regulatory Bundle* (documentación +
        dirección local, ~2 días hábiles) y es más caro.
   - Formato argentino para WhatsApp: `+54 9 <área> <número>` (con el 9 después del 54, sin el 15).
5. **Documentos para la Business Verification** (para después, pero conseguirlos ya): constancia de
   inscripción de **AFIP/ARCA con CUIT** (sirve SAS/SRL con estatuto, o monotributista con la
   constancia a su nombre), factura de servicio o resumen bancario como prueba de domicilio, sitio
   web público que mencione el nombre del negocio, email con dominio propio. PDFs/imágenes claras,
   menos de 8 MB.

## 3. Registro del sender (paso a paso, ~15 minutos)

1. Console → **Messaging → Senders → WhatsApp senders → Create new sender**.
2. Elegir el número (de la cuenta Twilio o "bring your own number") → Continue.
3. Se abre el **popup de Meta (Embedded Signup)**. No cerrarlo a mitad de camino (deja el registro
   colgado y hay que reiniciar), mismo navegador, no compartir la URL.
4. Dentro del popup, en orden:
   - Login con Facebook y aceptar los permisos para que Twilio administre la WABA.
   - Seleccionar o crear el **Business Portfolio** (nombre legal, dirección).
   - Crear una **WABA nueva** (no seleccionar una creada fuera de Twilio — rompe el registro;
     Twilio mantiene relación 1:1 cuenta↔WABA).
   - Perfil del negocio: nombre interno de la WABA, **display name** visible ("CONSTRUCTA" —
     ver trabas en §7), categoría, descripción y website opcionales.
   - **Verificación OTP del número** por SMS o llamada. Si es número Twilio, el código aparece en
     la Console; si es número propio, llega al teléfono.
   - Confirm en "Review Twilio's access request".
5. El popup se cierra, Twilio termina el registro en minutos. **El sender ya puede enviar y recibir.**

## 4. Después del registro

- **Webhook**: en el sender (Edit sender) cargar la URL del endpoint FastAPI de siempre
  (`/webhooks/whatsapp`). El formato del payload es idéntico al del sandbox.
- **Config**: cambiar `TWILIO_WHATSAPP_NUMBER` en el `.env` — es el único cambio de código/config.
  `twilio.rest.Client`, el parser y la validación de firma siguen iguales.
- **Perfil**: foto, descripción, dirección, sitio web (mejora confianza y ayuda a aprobar el
  display name).
- **Plantillas (Content Templates)**: crear en el Content Template Builder (Console o API) las
  plantillas para mensajes que CONSTRUCTA inicia **fuera de la ventana de 24 hs** (alertas de
  vencimiento, recordatorios de asignación de obra). Categoría **utility** (más barata, menos
  rechazos). Aprobación de Meta: minutos a 48 hs. Con la API se envían con `content_sid` +
  `content_variables` en vez de `body` — un `body` libre fuera de ventana falla con **error 63016**.
  Dentro de la ventana de 24 hs post-mensaje del usuario: texto libre, igual que en el sandbox.
- **Business Verification**: Meta Business Manager → **Security Center → Iniciar verificación**.
  Gratis, 1-5 días hábiles típico. El nombre cargado en Meta debe coincidir **letra por letra**
  con la constancia de AFIP (la discrepancia de nombre es la causa #1 de rechazo). Al aprobarse:
  el límite sube a 1.000 conversaciones iniciadas/día (y escala solo a 10k → 100k → ilimitado
  según volumen y calidad), y se puede pedir la tilde de Official Business Account.

## 5. Qué cambia respecto del sandbox

| Sandbox | Producción |
|---|---|
| Número compartido `+14155238886` | Número propio con display name "CONSTRUCTA" |
| Usuario debe mandar `join <código>` | Cualquiera escribe directo |
| Solo plantillas pre-registradas de Twilio | Plantillas propias aprobadas por Meta |
| Throttle 1 msg/3 seg | Sin throttle del sandbox; rigen los messaging limits de Meta |
| Sin costo de Meta | Plantillas fuera de ventana se cobran (ver §6) |

## 6. Costos

| Concepto | Costo |
|---|---|
| Registro/activación del sender (Twilio) | US$0 |
| Business Verification (Meta) | Gratis |
| Número Twilio US (si se compra) | ~US$1.15/mes |
| Fee Twilio por mensaje WhatsApp | US$0.005 (entrante y saliente) |
| Meta — plantilla utility (Argentina) | ~US$0.012-0.03 por mensaje entregado, solo fuera de ventana |
| Meta — plantilla marketing (Argentina) | ~US$0.06 por mensaje |
| Meta — texto libre dentro de ventana de 24 hs | Gratis (ojo: Meta anunció que los mensajes de servicio pasan a cobrarse desde el 01/10/2026 — verificar el rate card vigente al momento de operar) |

Con el patrón de uso de CONSTRUCTA (chatbot mayormente reactivo: el responsable escribe → el bot
responde dentro de la ventana), el costo de Meta es casi cero; se paga sobre todo el fee de Twilio.

## 7. Trabas comunes

1. **Error 63110 — número ya registrado en WhatsApp**: eliminar la cuenta de WhatsApp de ese
   número desde la app antes de registrar; si está en otro BSP, desactivar el 2FA en WhatsApp
   Manager y migrar.
2. **Display name rechazado**: pasa con nombres genéricos ("Construcciones"), nombres de persona,
   slogans, emojis, o cuando no coincide con el negocio/website. Consecuencia: cap de 250 msgs/día
   hasta corregir. Prevención: nombre real de marca, coherente con el Business Portfolio y con un
   sitio público que lo mencione. Se edita y apela desde WhatsApp Manager.
3. **Business Verification rechazada**: casi siempre por discrepancia de nombre con la constancia
   de AFIP, documentos ilegibles o falta de presencia online. Se puede reintentar.
4. **Número no elegible**: IVR o números que no reciben SMS/llamada. Verificar el OTP antes.
5. **Cerrar el popup de Meta a mitad de camino**: reinicia el flujo desde cero.
6. **Seleccionar una WABA externa en el popup**: rompe el registro — crear siempre una WABA nueva
   con el primer sender.

## 8. ¿Twilio o la API de Meta directa? (comparación 2026)

Ambos caminos usan la misma WhatsApp Business Platform de Meta por debajo — los requisitos de
cumplimiento (WABA, verificación, plantillas, opt-in) son idénticos. La diferencia es quién
intermedia y cuánto trabajo de integración implica.

| | Twilio (BSP, actual) | Meta Cloud API directa |
|---|---|---|
| Fee de intermediario | US$0.005 por mensaje (entrante y saliente, incluidos los gratis de Meta) | Ninguno — solo tarifas de Meta |
| Costo estimado a 1.000 msgs/mes (Argentina, mezcla típica) | ~US$15-16 | ~US$10-13 |
| Trabajo de integración | **Cero** — `integrations/twilio/` (client, parser, security) ya funciona | Reescribir la capa entera: webhook con firma `X-Hub-Signature-256` (HMAC, distinta a la de Twilio), payload JSON de Graph API (hoy es form-encoded), descarga de media por media-ID con token (hoy son URLs firmadas), gestión de plantillas vía Graph API/WhatsApp Manager |
| Onboarding | Self Sign-up en la Console (esta guía) | Directo en developers.facebook.com + Meta Business Suite (proceso equivalente, sin intermediario) |
| SDK y soporte | SDK Python maduro, consola con logs, soporte pago | Graph API a mano (o librerías de terceros), soporte de Meta estándar |
| Otras prestaciones | SMS/voz/email en la misma cuenta si algún día hacen falta | Solo WhatsApp |
| Riesgo/lock-in | El markup crece linealmente con el volumen | Relación directa con Meta, sin fee — pero todo el mantenimiento de la integración es propio |

**Recomendación (2026-09)**: quedarse en Twilio para salir del sandbox ya — el código no cambia y
el sobrecosto a volumen bajo es de pocos dólares por mes. Reevaluar la migración a Meta directa
cuando el volumen supere ~5.000-10.000 msgs/mes: ahí el ahorro (~30%) empieza a pagar el costo de
reescribir la integración. Los BSP de fee fijo (360dialog, ~US$59/mes sin markup) recién le ganan
a Twilio arriba de ~11.000 msgs/mes. Las librerías no oficiales (Baileys, whatsapp-web.js) quedan
descartadas: violan los términos de Meta y el baneo es permanente e inapelable.

## 9. Checklist mínimo (orden sugerido)

1. Decidir el número (recomendado: chip argentino nuevo dedicado, o número US de Twilio) y
   verificar que no esté en WhatsApp.
2. Upgradear la cuenta Twilio si sigue en trial.
3. Correr el Self Sign-up en la Console (~15 min): Business Portfolio + WABA nuevos, display
   name "CONSTRUCTA".
4. El mismo día: configurar el webhook del sender, cambiar `TWILIO_WHATSAPP_NUMBER` en el `.env`,
   probar ida y vuelta con un número real.
5. Crear 1-2 plantillas utility y esperar aprobación.
6. Iniciar la Business Verification en el Security Center con la constancia de AFIP.

---

### Fuentes

- [Register WhatsApp senders using Self Sign-up — Twilio](https://www.twilio.com/docs/whatsapp/self-sign-up)
- [WhatsApp Self Sign-up now available to all direct customers — Twilio](https://www.twilio.com/en-us/changelog/whatsapp-self-sign-up-now-available-to-all-direct-customers)
- [Test WhatsApp messaging with the Sandbox — Twilio](https://www.twilio.com/docs/whatsapp/sandbox)
- [Error 63110 — Twilio](https://www.twilio.com/docs/api/errors/63110)
- [WhatsApp pricing — Twilio](https://www.twilio.com/en-us/whatsapp/pricing)
- [Pricing on the WhatsApp Business Platform — Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Messaging Limits — Meta for Developers](https://developers.facebook.com/docs/whatsapp/messaging-limits/)
- [Business phone numbers (formato +54 9) — Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers)
- [Meta Business Verification — documentos por país (360dialog)](https://docs.360dialog.com/docs/resources/meta-business-verification)
- [Rules and Best Practices for WhatsApp Messaging on Twilio](https://support.twilio.com/hc/en-us/articles/360017773294-Rules-and-Best-Practices-for-WhatsApp-Messaging-on-Twilio)
