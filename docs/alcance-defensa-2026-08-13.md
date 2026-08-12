# Alcance y estado de la presentación del 13 de agosto de 2026

**Fecha de análisis:** 2026-07-24  
**Fuente de planificación:** `/Users/agustinllancaman/Downloads/Gantt_Proyecto.xlsx`  
**Fecha oficial de presentación:** 2026-08-13

> Este informe reemplaza, para el corte académico de agosto, la estimación global preliminar de `docs/estado-proyecto-agosto-2026.md`. Esa evaluación mezclaba el corte parcial con requisitos de entrega final y producción.

## Consigna oficial

- **2026-08-06:** último checkpoint y consultas finales.
- **2026-08-13:** presentación obligatoria y calificada del avance.
- **2026-08-20:** recuperatorio únicamente con justificación.
- **Duración máxima:** ocho minutos:
  - un minuto para presentar el proyecto y el avance respecto del Gantt;
  - cinco minutos de demostración funcional;
  - dos minutos para pendientes, próximos pasos y organización del equipo.

Se recomienda llevar la demostración desplegada y la presentación accesible desde cualquier equipo. Si se usa una notebook propia, debe prepararse también la conexión al proyector y una contingencia visual para los servicios externos.

## 1. Veredicto

CONSTRUCTA está bien posicionado para la presentación del 13 de agosto:

| Indicador | Resultado |
|---|---:|
| Alcance técnico/funcional del corte ya implementado | **89,6%** |
| Cierre ponderado de actividades del corte | **87,1%** |
| Actividades totalmente cerradas | **50/66 = 75,8%** |
| Paquete completo listo para defender hoy | **73–76%** |
| Avance funcional que el Gantt espera para el proyecto global al 13/08 | **51,4%** |

La diferencia entre “90% técnico” y “75% defendible” se explica por:

- ausencia de una presentación y un guion ensayado;
- pruebas funcionales/E2E con poca evidencia reproducible;
- relevamiento con expertos reconstruido sin actas contemporáneas ni validación posterior;
- análisis de mensajes reales sustentado por pocos casos;
- IPI alineado en estructura y objetivos, pero todavía sin resultados de pruebas, figuras, estudio económico y reflexión final.

No conviene agregar funcionalidades nuevas antes de la presentación. El esfuerzo debe pasar a evidencia, relato y ensayo.

## 2. Corte exacto del Gantt

- Inicio: **2026-04-07**, día 1.
- Fin: **2027-02-01**, día 301.
- Presentación: **2026-08-13**, día 129.
- El corte cae en la semana S19, que abarca del 11 al 17 de agosto.
- Las duraciones son días calendario.

Según el plan, al finalizar el 13 de agosto debería haber:

- **64 actividades finalizadas**;
- **2 actividades en curso**;
- **31 actividades futuras**.

Las dos actividades en curso son:

| Actividad | Plan | Avance temporal al 13/08 |
|---|---|---:|
| Documentación del proyecto | 07/04/2026–01/02/2027 | 129/301 = **42,9%** |
| Extracción de eventos y estados | 11/08/2026–16/08/2026 | 3/6 = **50,0%** |

El último entregable que debe estar completamente cerrado antes de la presentación es:

> **Implementación del parser de mensajes — fin planificado: 2026-08-10.**

La extracción de eventos y estados termina el 16 de agosto. En la presentación debe mostrarse como trabajo en curso, tal como indica el Gantt, diferenciando lo ya demostrable de lo que queda por cerrar.

## 3. Qué corresponde defender

### MVP base

- definición del problema, dominio, requerimientos y alcance;
- arquitectura, modelo de datos, flujos e interfaz;
- usuarios, obras, responsables, tareas y estados;
- Gantt, dashboard, alertas e historial;
- chatbot de WhatsApp:
  - envío de consultas;
  - recepción estructurada;
  - actualización de estados;
- integración frontend–backend–chatbot;
- pruebas y validación inicial del MVP.

### Consolidación del MVP

- ajustes posteriores a la validación;
- refactorización de arquitectura;
- mejoras UX/UI;
- estabilización del chatbot;
- logging y trazabilidad básica.

### Bitácora de obra

- diseño conceptual y modelo de datos;
- backend y frontend;
- recepción desde WhatsApp;
- transcripción y análisis;
- timeline y filtros;
- asociación con obras;
- vínculo bidireccional con tareas.

### Interpretación de mensajes al corte

- análisis de mensajes reales;
- diseño del modelo de interpretación;
- parser de mensajes;
- extracción demostrable de eventos y estados, aclarando que su fin planificado es el 16 de agosto.

## 4. Qué no corresponde exigir en esta defensa

Las siguientes actividades empiezan después del corte:

| Actividad/fase | Inicio planificado |
|---|---:|
| Generación de insights | 2026-08-17 |
| Sugerencia asistida de tareas | 2026-08-22 |
| Hito “Módulos avanzados implementados” | 2026-08-28 |
| Análisis contextual del estado de obra | 2026-08-29 |
| Alertas inteligentes | 2026-09-13 |
| Dashboard avanzado | 2026-09-29 |
| Validación con usuarios reales | 2026-10-24 |
| Iteración final | 2026-11-26 |
| Cierre final de documentos | 2026-12-15 |
| Defensa y entrega final | 2027-01-14 |

Tampoco deben presentarse como compromisos originales de agosto:

- presupuestos con IA;
- materiales, compras y cotizaciones;
- planes comerciales;
- presencia colaborativa;
- importación avanzada de MS Project;
- otras ampliaciones que no estaban en el Anteproyecto.

Pueden mostrarse brevemente como trabajo adelantado, después de demostrar el alcance comprometido.

## 5. Estado real por fase

Escala:

- **Completo:** existe implementación o documento verificable.
- **Parcial:** existe, pero falta evidencia, cierre o cobertura.
- **Pendiente:** no se encontró evidencia suficiente.

| Fase | Estado | Brecha principal |
|---|---|---|
| Planificación | Mayormente completa | El relevamiento está reconstruido en el IPI; falta la matriz detallada y su validación posterior con los participantes. |
| Investigación chatbot | Parcial | Faltan comparación formal de alternativas y registro del análisis. |
| Diseño del sistema | Completa | Preparar diagramas legibles para la exposición. |
| Base de datos | Mayormente completa | Carga inicial e integridad tienen evidencia automatizada limitada. |
| Backend MVP | Completa funcionalmente | Las pruebas no cubren toda la lógica. |
| Frontend MVP | Completa funcionalmente | No existen tests de frontend. |
| Chatbot MVP | Completa funcionalmente | Preparar contingencia si falla WhatsApp/Twilio. |
| Integración | Completa funcionalmente | Falta acta reproducible del flujo E2E. |
| Testing y validación | Parcial | Los 20 casos manuales no registran resultados reales. |
| Cierre inicial | Parcial | El IPI es un borrador avanzado y la presentación está pendiente. |
| Documentación continua | Parcial y adelantada | El contenido ya está alineado con el Anteproyecto; faltan evidencia, figuras y datos del equipo. |
| Consolidación del MVP | Mayormente completa | Estabilización y robustez operativa siguen parciales. |
| Bitácora | Completa funcionalmente | Faltan pruebas automatizadas del pipeline. |
| Interpretación al 13/08 | Mayormente completa técnicamente | Falta un corpus de mensajes y resultados reproducibles. |

### Conteo del corte

- 50 actividades completas.
- 15 actividades parciales, incluido el relevamiento retrospectivo con expertos.
- 1 actividad pendiente: preparación de la presentación.

## 6. Evidencia técnica disponible

- Arquitectura y modelo: `docs/diagramas/`, `docs/database.md`, modelos SQLAlchemy y migraciones de código `0001–0043`. La base local auditada estaba en `0041` y debe actualizarse antes de depender de las funciones de `0042` y `0043`.
- Backend MVP: routers y servicios de usuarios, obras, responsables, tareas y alertas.
- Frontend MVP: login, portfolio, obra, tareas, Gantt, resumen y alertas.
- Chatbot: `message_service.py`, `conversation_service.py`, parser de Twilio y webhook.
- Bitácora:
  - modelo y schemas;
  - rutas de audio/texto;
  - transcripción;
  - análisis estructurado;
  - frontend;
  - vínculo con tareas.
- Interpretación:
  - JSON Schema;
  - prompt contextual;
  - tipos `reschedule_task`, `create_task`, `update_status` y `note`;
  - aplicación de acciones e historial.
- Validación técnica general:
  - backend operativo;
  - 24 tests de backend aprobados;
  - build del frontend aprobado.

La evidencia automatizada no prueba actualmente el flujo completo de WhatsApp, bitácora e interpretación.

## 7. Ambigüedad que debe resolverse al exponer

“Interpretación de mensajes” puede significar dos cosas:

1. **Audios/transcripciones de bitácora:** está implementado con IA y salida estructurada.
2. **Texto libre enviado por responsables:** no está implementado como NLP libre; el chatbot textual usa menús y respuestas estructuradas.

El Anteproyecto excluía la interpretación avanzada de respuestas libres. Por lo tanto, la defensa debe formularse así:

> El sistema interpreta de forma estructurada las respuestas operativas del chatbot y utiliza IA para analizar audios y textos de la bitácora. La comprensión irrestricta de mensajes libres no forma parte del corte.

## 8. Faltantes que sí bloquean una buena defensa

### 1. Evidencia del relevamiento de dominio

El IPI ya identifica perfiles, fecha, modalidad, límites y hallazgos reconstruidos. Falta completar:

- una matriz que separe cada encuentro o grupo de participantes;
- los hallazgos que el equipo recuerda con suficiente certeza;
- las decisiones de producto derivadas;
- una validación posterior de esa síntesis por parte de los participantes, si resulta posible.

No deben presentarse citas textuales ni conclusiones atribuidas con precisión que la evidencia disponible no permita sostener.

### 2. Corpus de mensajes

Crear una tabla pequeña de 10–15 mensajes o audios anonimizados/simulados:

`Entrada | intención esperada | evento/estado esperado | salida real | resultado`

Debe incluir:

- inicio de tarea;
- tarea finalizada;
- demora/bloqueo;
- pedido de reprogramación;
- nota sin acción;
- mensaje ambiguo;
- audio con más de una acción.

### 3. Resultados de pruebas

Completar para los casos críticos:

`fecha | versión/commit | ejecutor | resultado real | evidencia | incidencia`

Como mínimo:

- login;
- crear obra/tarea/responsable;
- Gantt y alertas;
- estado desde WhatsApp;
- bitácora por audio;
- extracción de evento/estado;
- historial.

### 4. Presentación y demo

No existe en el Gantt un hito específico para el 13 de agosto. Debe agregarse operativamente:

- preparación de diapositivas;
- preparación de datos;
- ensayo;
- video/capturas de contingencia;
- congelamiento de versión.

### 5. Cierre documental del IPI

La alineación principal ya fue aplicada: se restituyeron los doce objetivos, se agregó la matriz de estado, se separó la evolución del alcance y se actualizaron migraciones, pruebas y límites. Antes de mostrar el documento falta:

- incorporar resultados reales y capturas de los recorridos críticos;
- completar la matriz retrospectiva del relevamiento;
- actualizar el DER y las figuras necesarias;
- mantener visibles los pendientes económicos y de aceptación que corresponden a etapas posteriores.

## 9. Qué puede esperar hasta después de agosto

Según el Gantt, no bloquea esta presentación:

- costos y ROI cerrados;
- beneficios cuantificados definitivos;
- conclusión final;
- IPI completamente terminado;
- validación con usuarios reales;
- cobertura automatizada integral;
- despliegue productivo;
- observabilidad y escalado;
- módulos avanzados posteriores al corte.

Los riesgos de seguridad encontrados en módulos extra deben corregirse antes de afirmar que el producto es un SaaS multiempresa listo para producción, pero no impiden una defensa académica del MVP si el alcance se comunica con precisión.

## 10. Guion recomendado para la demostración

1. Problema y objetivo.
2. Corte del Gantt al 13 de agosto.
3. Crear o abrir una obra preparada.
4. Mostrar tareas, responsables y dependencias.
5. Mostrar Gantt, dashboard y alertas.
6. Responder por WhatsApp y verificar estado e historial.
7. Enviar una nota de voz.
8. Mostrar transcripción, bitácora y vínculo con una tarea.
9. Mostrar el parser y el evento/estado extraído.
10. Cerrar con pruebas, avance y fases posteriores.

Preparar:

- base de demostración estable;
- credenciales verificadas;
- audio corto de respaldo;
- capturas;
- video del flujo WhatsApp/IA;
- versión etiquetada del código.

Para el cierre de dos minutos puede explicarse que el equipo trabaja con propiedad compartida de código y documentación, realiza una reunión semanal y comunica avances de forma asincrónica por WhatsApp. La dedicación varía por las obligaciones académicas. Como mejora inmediata para llegar a la presentación, cada pendiente deberá tener un responsable principal, fecha y evidencia de cierre, aunque el resto del equipo continúe colaborando.

## 11. Plan hasta la presentación

### 2026-07-24 a 2026-07-28

- Formalizar el análisis de mensajes reales.
- Completar la matriz retrospectiva del relevamiento a partir de la base ya redactada.
- Crear el corpus de mensajes.
- Incorporar al IPI el vínculo hacia la evidencia que se genere.

### 2026-07-29 a 2026-08-03

- Documentar el modelo de interpretación.
- Cerrar pruebas críticas del MVP y bitácora.
- Registrar resultados y capturas.

### 2026-08-04 a 2026-08-10

- Validar el parser con el corpus.
- Preparar diapositivas, datos y guion.
- Congelar el alcance de la demo.

### 2026-08-11 a 2026-08-12

- Delimitar qué parte de la extracción de eventos/estados ya es demostrable.
- Ensayar la exposición.
- Corregir fallos de demostración.
- Etiquetar la versión.
- Preparar contingencias.

### 2026-08-13

- Presentar el alcance comprometido en un máximo de ocho minutos.
- Mostrar los extras únicamente al final y como adelantos.

## 12. Corrección respecto del diagnóstico preliminar

La estimación global anterior de 68% no debe usarse para esta presentación porque:

- evaluaba también requisitos de producción y entrega final;
- utilizaba una copia incompleta del Gantt;
- asumía erróneamente que la planificación terminaba en junio;
- exigía cierres que el plan ubica entre agosto de 2026 y febrero de 2027.

Para el 13 de agosto, las cifras relevantes son:

- **89,6% técnico del alcance del corte**;
- **73–76% del paquete defendible actual**;
- **51,4% del proyecto funcional global planificado para esa fecha**.
