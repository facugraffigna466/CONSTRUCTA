# Alcance y estado de la defensa del 15 de agosto de 2026

**Fecha de análisis:** 2026-07-23  
**Fuente de planificación:** `/Users/agustinllancaman/Downloads/Gantt_Proyecto.xlsx`  
**Fecha de presentación informada por el equipo:** 2026-08-15

> Este informe reemplaza, para el corte académico de agosto, la estimación global preliminar de `docs/estado-proyecto-agosto-2026.md`. Esa evaluación mezclaba el corte parcial con requisitos de entrega final y producción.

## 1. Veredicto

CONSTRUCTA está bien posicionado para la presentación del 15 de agosto:

| Indicador | Resultado |
|---|---:|
| Alcance técnico/funcional del corte ya implementado | **89,6%** |
| Actividades completas o parciales del corte | **86,4%** |
| Actividades totalmente cerradas | **50/66 = 75,8%** |
| Paquete completo listo para defender hoy | **73–76%** |
| Avance funcional que el Gantt espera para el proyecto global al 15/08 | **51,9%** |

La diferencia entre “90% técnico” y “75% defendible” se explica por:

- ausencia de una presentación y un guion ensayado;
- pruebas funcionales/E2E con poca evidencia reproducible;
- entrevistas con expertos sin actas ni resultados;
- análisis de mensajes reales sustentado por pocos casos;
- IPI desalineado respecto de los objetivos aprobados.

No conviene agregar funcionalidades nuevas antes de la presentación. El esfuerzo debe pasar a evidencia, relato y ensayo.

## 2. Corte exacto del Gantt

- Inicio: **2026-04-07**, día 1.
- Fin: **2027-02-01**, día 301.
- Presentación: **2026-08-15**, día 131.
- El corte cae en la semana S19, que abarca del 11 al 17 de agosto.
- Las duraciones son días calendario.

Según el plan, al finalizar el 15 de agosto debería haber:

- **64 actividades finalizadas**;
- **2 actividades en curso**;
- **31 actividades futuras**.

Las dos actividades en curso son:

| Actividad | Plan | Avance temporal al 15/08 |
|---|---|---:|
| Documentación del proyecto | 07/04/2026–01/02/2027 | 131/301 = **43,5%** |
| Extracción de eventos y estados | 11/08/2026–16/08/2026 | 5/6 = **83,3%** |

El último entregable que debe estar completamente cerrado antes de la presentación es:

> **Implementación del parser de mensajes — fin planificado: 2026-08-10.**

La extracción de eventos y estados termina el 16 de agosto. Para evitar una defensa ambigua conviene:

- adelantar su cierre técnico al 14 de agosto; o
- mostrarla como trabajo en curso, tal como indica el Gantt.

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
| Planificación | Mayormente completa | Las entrevistas con expertos están pendientes de documentar. |
| Investigación chatbot | Parcial | Faltan comparación formal de alternativas y registro del análisis. |
| Diseño del sistema | Completa | Preparar diagramas legibles para la exposición. |
| Base de datos | Mayormente completa | Carga inicial e integridad tienen evidencia automatizada limitada. |
| Backend MVP | Completa funcionalmente | Las pruebas no cubren toda la lógica. |
| Frontend MVP | Completa funcionalmente | No existen tests de frontend. |
| Chatbot MVP | Completa funcionalmente | Preparar contingencia si falla WhatsApp/Twilio. |
| Integración | Completa funcionalmente | Falta acta reproducible del flujo E2E. |
| Testing y validación | Parcial | Los 20 casos manuales no registran resultados reales. |
| Cierre inicial | Parcial | El informe es borrador y la presentación está pendiente. |
| Documentación continua | Parcial y adelantada | El contenido existe, pero necesita alineación con el Anteproyecto. |
| Consolidación del MVP | Mayormente completa | Estabilización y robustez operativa siguen parciales. |
| Bitácora | Completa funcionalmente | Faltan pruebas automatizadas del pipeline. |
| Interpretación al 15/08 | Mayormente completa técnicamente | Falta un corpus de mensajes y resultados reproducibles. |

### Conteo del corte

- 50 actividades completas.
- 14 actividades parciales.
- 2 actividades pendientes:
  - entrevistas con expertos;
  - preparación de la presentación.

## 6. Evidencia técnica disponible

- Arquitectura y modelo: `docs/diagramas/`, `docs/database.md`, modelos SQLAlchemy y migraciones `0001–0041`.
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
  - migraciones en `0041`;
  - 16 tests aprobados;
  - build del frontend aprobado.

La evidencia automatizada no prueba actualmente el flujo completo de WhatsApp, bitácora e interpretación.

## 7. Ambigüedad que debe resolverse al exponer

“Interpretación de mensajes” puede significar dos cosas:

1. **Audios/transcripciones de bitácora:** está implementado con IA y salida estructurada.
2. **Texto libre enviado por responsables:** no está implementado como NLP libre; el chatbot textual usa menús y respuestas estructuradas.

El Anteproyecto excluía la interpretación avanzada de respuestas libres. Por lo tanto, la defensa debe formularse así:

> El sistema interpreta de forma estructurada las respuestas operativas del chatbot y utiliza IA para analizar audios y textos de la bitácora. La comprensión irrestricta de mensajes libres no forma parte del corte.

## 8. Faltantes que sí bloquean una buena defensa

### 1. Entrevistas/análisis de dominio

Preparar:

- entrevistados o perfiles;
- fecha y modalidad;
- preguntas;
- hallazgos;
- decisiones de producto derivadas.

Si no hubo entrevistas formales, no afirmar que se completaron: presentar observaciones del dominio y planificar el relevamiento.

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

No existe en el Gantt un hito específico para el 15 de agosto. Debe agregarse operativamente:

- preparación de diapositivas;
- preparación de datos;
- ensayo;
- video/capturas de contingencia;
- congelamiento de versión.

### 5. Alineación del IPI

Antes de mostrar el documento:

- restaurar los 12 objetivos aprobados;
- agregar `objetivo → estado al 15/08 → evidencia → pendiente`;
- separar alcance aprobado de ampliaciones;
- cambiar el tono de “informe final” por estado de avance;
- actualizar `0038 → 0041`;
- eliminar afirmaciones de pruebas o seguridad sin evidencia;
- documentar las entrevistas y mensajes reales.

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
2. Corte del Gantt al 15 de agosto.
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

## 11. Plan hasta la presentación

### 2026-07-24 a 2026-07-28

- Formalizar el análisis de mensajes reales.
- Documentar entrevistas o corregir su estado.
- Crear el corpus de mensajes.
- Restaurar objetivos y tabla de avance en el IPI.

### 2026-07-29 a 2026-08-03

- Documentar el modelo de interpretación.
- Cerrar pruebas críticas del MVP y bitácora.
- Registrar resultados y capturas.

### 2026-08-04 a 2026-08-10

- Validar el parser con el corpus.
- Preparar diapositivas, datos y guion.
- Congelar el alcance de la demo.

### 2026-08-11 a 2026-08-14

- Cerrar o delimitar la extracción de eventos/estados.
- Ensayar la exposición.
- Corregir fallos de demostración.
- Etiquetar la versión.
- Preparar contingencias.

### 2026-08-15

- Defender el alcance comprometido.
- Mostrar los extras únicamente al final y como adelantos.

## 12. Corrección respecto del diagnóstico preliminar

La estimación global anterior de 68% no debe usarse para esta presentación porque:

- evaluaba también requisitos de producción y entrega final;
- utilizaba una copia incompleta del Gantt;
- asumía erróneamente que la planificación terminaba en junio;
- exigía cierres que el plan ubica entre agosto de 2026 y febrero de 2027.

Para el 15 de agosto, las cifras relevantes son:

- **89,6% técnico del alcance del corte**;
- **73–76% del paquete defendible actual**;
- **51,9% del proyecto funcional global planificado para esa fecha**.
