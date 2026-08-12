# Estado de CONSTRUCTA para la primera entrega de agosto de 2026

**Fecha de corte:** 2026-07-23  
**Tipo de evaluación:** diagnóstico interno basado en documentos, código y validaciones locales.  
**Importante:** los porcentajes de este informe son estimaciones operativas, no una calificación oficial de la cátedra.

> **Actualización:** este diagnóstico preliminar fue reemplazado, para la presentación obligatoria y calificada del **2026-08-13**, por [`alcance-defensa-2026-08-13.md`](alcance-defensa-2026-08-13.md), elaborado con el Gantt completo y la consigna oficial. La cifra global de 68% no debe utilizarse para evaluar ese corte parcial.

## 1. Resumen ejecutivo

CONSTRUCTA es un proyecto funcionalmente avanzado, pero su nivel de terminación depende de qué se mida:

| Dimensión | Estimación | Lectura |
|---|---:|---|
| Implementación de los 17 compromisos originales consolidados | **78%** | El camino feliz y la mayoría de los módulos existen. |
| Evidencia objetiva y pruebas de esos compromisos | **35%** | Hay build y 24 tests de backend, pero cubren solo parte del sistema; faltan frontend, E2E y actas de ejecución manual. |
| Estructura del IPI frente a la plantilla | **94%** | Están 15 de los 16 bloques esperados; falta el índice. |
| Contenido del IPI como borrador | **~75%** | Tiene 8.279 palabras, arquitectura, módulos y anexos; quedan datos, evidencias y correcciones importantes. |
| IPI listo para una entrega final | **55–60%** | Persisten marcadores, desalineación con el anteproyecto, citas incompletas, figuras faltantes y afirmaciones obsoletas. |
| Preparación técnica para una demostración académica local | **70–75%** | La aplicación inicia, compila y permite mostrar el flujo principal, pero falta un guion E2E verificado y repetible. |
| Preparación para producción multiempresa | **<60%** | Existen controles cross-tenant faltantes, integraciones no cubiertas, archivos locales y ausencia de despliegue/observabilidad. |

**Estimación global para una primera entrega de agosto:** **aproximadamente 68% (±5 puntos)**, suponiendo que se pida un avance de informe más una demostración del MVP. Esta cifra debe recalcularse cuando se conozca la consigna exacta de la entrega.

La prioridad no debería ser agregar módulos. El mayor retorno está en:

1. alinear el IPI con los objetivos aprobados;
2. cerrar los controles de seguridad todavía abiertos;
3. probar y registrar el flujo principal;
4. completar evidencia, costos, citas y figuras;
5. actualizar y rebaselinar el Gantt.

## 2. Fuentes revisadas y limitaciones

### Fuentes

- `Anteproyecto.docx`, aportado por el equipo.
- `Modulos y sus funcionalidades.docx`, aportado por el equipo.
- `[Plantilla IPI] - Informe de Proyecto Integrador - Guia de Ejemplo - v2.1 - 2026.pdf`, 21 páginas.
- `docs/IPI-CONSTRUCTA.md` y `docs/IPI-CONSTRUCTA.docx`.
- `docs/documentacion.md`, `docs/casos_de_prueba.md` y `docs/auditoria-sistema-consolidada.md`.
- Código actual de `backend/`, `frontend/`, migraciones, tests y CI.
- Copia local `/Users/agustinllancaman/Downloads/Gantt_Final_Constructa.xlsx`, creada el 2026-04-14.

### Limitación del Gantt online

El enlace de Google Sheets devolvió HTTP `401 Unauthorized`; por lo tanto, no fue posible confirmar si la hoja online tiene actualizaciones posteriores. Para revisarla se necesita una de estas dos opciones:

- habilitar “cualquier persona con el enlace puede ver”; o
- descargar la hoja actual como `.xlsx` y compartirla.

El análisis de planificación usa provisionalmente la copia local.

### Limitación de la consigna de agosto

La plantilla IPI v2.1–2026 **no especifica**:

- qué debe contener la primera entrega de agosto;
- fecha o modalidad;
- porcentaje mínimo;
- rúbrica;
- extensión, tipografía o formato de archivo;
- cantidad mínima de pruebas o cobertura;
- grado de implementación exigido.

La consigna de agosto debe obtenerse del aula virtual o de los docentes antes de congelar el paquete de entrega.

## 3. Estado del Gantt

La copia local contiene **48 actividades** distribuidas en 10 fases:

| Fase | Actividades |
|---|---:|
| Planificación | 6 |
| Investigación y aprendizaje del chatbot | 4 |
| Diseño del sistema | 4 |
| Desarrollo de base de datos | 5 |
| Desarrollo backend | 6 |
| Desarrollo frontend | 5 |
| Desarrollo chatbot | 5 |
| Integración | 4 |
| Testing y validación | 6 |
| Cierre | 3 |

El cronograma va del **2026-04-07 al 2026-06-01**. A la fecha de corte, todas las fechas planificadas ya vencieron.

El archivo no contiene:

- estado;
- porcentaje completado;
- fecha real de inicio o fin;
- responsable;
- evidencia;
- riesgo o bloqueo;
- hito de la entrega de agosto.

Por ese motivo, el Gantt permite conocer el plan original, pero **no permite calcular el avance real**. No es válido afirmar “X% según el Gantt”.

### Recomendación para rebaselinarlo

Agregar como mínimo:

`Estado | % real | Responsable | Inicio real | Fin real | Evidencia | Bloqueo | Prioridad agosto`

Las 48 actividades originales deberían marcarse contra evidencia del repositorio y luego agregarse tareas de cierre documental, seguridad, pruebas y defensa.

## 4. Estado funcional contra los compromisos originales

Se consolidaron 17 compromisos a partir del Anteproyecto y del documento de módulos. La escala es:

- `0`: inexistente;
- `0,25`: esqueleto;
- `0,50`: backend o frontend parcial;
- `0,75`: flujo integrado funcional;
- `1,00`: completo en implementación.

La columna “evidencia” exige además pruebas reproducibles o resultados registrados.

| # | Compromiso | Implementación | Evidencia |
|---:|---|---:|---:|
| 1 | Obras | 1,00 | 0,50 |
| 2 | Tareas e hitos | 1,00 | 0,50 |
| 3 | Responsables | 0,75 | 0,25 |
| 4 | Chatbot WhatsApp bidireccional | 0,75 | 0,25 |
| 5 | Estados automáticos y seguimiento | 0,75 | 0,25 |
| 6 | Alertas | 1,00 | 0,25 |
| 7 | Gantt | 1,00 | 0,50 |
| 8 | Dashboard | 1,00 | 0,50 |
| 9 | Documentación y consulta por chatbot | 0,75 | 0,25 |
| 10 | Registro manual sin alterar estado | 0,75 | 0,25 |
| 11 | Historial y trazabilidad | 1,00 | 0,25 |
| 12 | Bitácora de audio con IA | 0,75 | 0,25 |
| 13 | Autenticación y roles | 0,50 | 0,25 |
| 14 | Integraciones externas | 0,50 | 0,25 |
| 15 | API/OpenAPI documentada | 1,00 | 1,00 |
| 16 | Pruebas funcionales e integración | 0,25 | 0,25 |
| 17 | Escenario completo de demostración | 0,50 | 0,25 |
|  | **Resultado** | **13,25/17 = 78%** | **6/17 = 35%** |

### Interpretación

El proyecto supera el nivel de prototipo visual: hay backend, persistencia, frontend e integraciones reales. Sin embargo, “implementado” todavía no equivale a “cerrado” porque muchas capacidades carecen de pruebas automatizadas o de un acta de ejecución manual.

El camino crítico académico sigue siendo:

`autenticación → obra → tarea → responsable → recordatorio/chatbot → cambio de estado → dashboard/Gantt → historial`

Ese flujo debe poder ejecutarse de principio a fin, con datos de demostración conocidos y capturas o resultados conservados.

## 5. Salud técnica comprobada

### Validaciones positivas

- Backend y frontend locales respondieron HTTP `200`.
- Migraciones de código: `0001–0043`; la base local auditada permanece en `0041`.
- Backend: 112 rutas totales, 107 bajo `/api/v1`.
- `pytest`: **24 tests aprobados**; 16 advertencias no bloqueantes.
- Frontend: TypeScript y build de Vite aprobados; 2.630 módulos transformados.
- Existe CI en `.github/workflows/ci.yml` para ejecutar `pytest` y el build en pushes a `main` y pull requests.

### Cobertura insuficiente

- No existen tests de frontend.
- No existen pruebas E2E automatizadas.
- No hay medición de cobertura.
- `docs/casos_de_prueba.md` describe 20 casos y resultados esperados, pero no registra fecha, ejecutor, resultado real ni evidencia.
- Las integraciones externas —WhatsApp, correo e IA— no forman parte de una suite reproducible.
- El bundle principal mide aproximadamente 1,12 MB minificado y Vite advierte que supera 500 kB.

### Estado Git

- La rama evaluada es `fix/a11y-modales-2`, un commit por delante de `main`.
- La segunda fase de accesibilidad todavía no está integrada a `main`.
- El arreglo de arranque `DEBUG → APP_DEBUG` está sin commit.

Antes de entregar debe existir una rama o etiqueta única que represente exactamente la versión demostrada.

## 6. Riesgo de seguridad no reflejado correctamente en la auditoría previa

`docs/auditoria-sistema-consolidada.md` afirma que el cluster P0 multiempresa está cerrado. La revisión del código actual encontró rutas que todavía no validan correctamente el tenant:

- cambio de rol y eliminación de usuarios;
- listados, modificación y baja de proveedores;
- lectura, creación, envío y recepción de órdenes de compra;
- exportación de presupuesto;
- búsqueda global de responsable por WhatsApp;
- presencia HTTP/Socket.IO global;
- carga de planos sobre una obra ajena;
- creación de presupuestos vinculados a una obra ajena;
- incorporación de responsables ajenos al equipo de una obra.

Los tests actuales no cubren esos flujos. Por lo tanto:

- el producto puede demostrarse localmente con un único tenant;
- **no debe presentarse como SaaS multiempresa seguro o listo para producción** hasta corregirlos y agregar regresiones;
- las afirmaciones del IPI sobre aislamiento “estricto” deben condicionarse a esa corrección.

## 7. Estado del documento IPI

### Lo que está bien

El borrador `docs/IPI-CONSTRUCTA.md` es sustancial:

- 431 líneas y 8.279 palabras;
- portada;
- resumen y abstract;
- presentación, glosario y diagnóstico;
- objetivos y tabla de trazabilidad;
- marco teórico;
- propuesta, alcance, diseño e implementación;
- pruebas;
- beneficios e impactos;
- conclusión, referencias y anexos;
- tres diagramas ya incorporados: casos de uso, arquitectura y DER.

La redacción es mayormente formal, impersonal y compatible con la guía.

### Cumplimiento estructural

La plantilla plantea 16 bloques. El borrador contiene 15 y carece de **índice**. Su estructura es, por lo tanto, aproximadamente **94% completa**.

### Por qué todavía no está listo para entregar

1. **Objetivos desalineados.**  
   El Anteproyecto aprobó 12 objetivos específicos; el IPI los reemplazó por 9 objetivos nuevos. Esto rompe la trazabilidad histórica.

2. **Compromisos originales omitidos o diluidos.**  
   Falta conservar claramente como objetivos/evidencia:
   - dashboard;
   - consultas automáticas salientes por WhatsApp;
   - registro manual;
   - historial integral;
   - API documentada;
   - escenario de demostración.

3. **Ampliación de alcance sin explicación.**  
   Se agregaron WBS, CPM, baseline, planilla avanzada, presupuestos con IA, compras, multi-tenant, planes, presencia e invitaciones. Debe existir una sección “Evolución del alcance”.

4. **Contradicción directa con el Anteproyecto.**  
   El Anteproyecto excluía costos, presupuestos y finanzas; el IPI actual convierte materiales, cotizaciones y compras en un bloque central. Si la ampliación no fue aprobada, debe mostrarse como mejora adicional, no como objetivo original.

5. **Datos obsoletos.**  
   El informe mencionaba migraciones hasta `0038`; el código actual llega a `0043` y la base local auditada permanece en `0041`.

6. **Pruebas sobreafirmadas.**  
   El texto dice que los módulos y flujos E2E fueron verificados, pero los casos manuales no registran resultados reales y los 24 tests automatizados cubren un subconjunto.

7. **Seguridad sobreafirmada.**  
   No corresponde afirmar aislamiento estricto de tenants mientras existan las rutas señaladas en la sección anterior.

8. **Marcadores pendientes.**  
   Existen ocho bloques `[COMPLETAR]`, además de nombres, directores, fecha, cifras de costos y URL del repositorio.

9. **Figuras faltantes.**  
   Hay siete figuras previstas; tres diagramas están incorporados y faltan cuatro capturas de pantalla.

10. **Resumen fuera del máximo.**  
    El Resumen tiene aproximadamente 320 palabras y la guía fija un máximo de 300. El Abstract tiene aproximadamente 269.

11. **Bibliografía sin correspondencia.**  
    Hay 13 referencias, pero solo se identifican dos citas APA explícitas en el cuerpo. La guía exige correspondencia exacta y uso de la herramienta de citas de Google Docs.

12. **Marco teórico débil en evidencia de dominio.**  
    Faltan el relevamiento de campo, fuentes para la comparación de mercado y sustento académico/local de la problemática.

13. **Impacto económico incompleto.**  
    Faltan horas reales, valor hora, costos operativos vigentes, ahorro esperado y retorno de inversión.

14. **Afirmaciones absolutas no demostradas.**  
    Deben moderarse o probarse frases sobre escalado horizontal, no repudio, costo por audio y adaptación al español rioplatense.

### Estimación documental

- **Estructura:** 94%.
- **Borrador de contenido:** ~75%.
- **Preparación para una entrega final conforme y defendible:** 55–60%.

## 8. Formato exigido por la plantilla IPI v2.1–2026

### Reglas explícitas

- Redacción formal, clara, objetiva e impersonal/tercera persona.
- Párrafos normales justificados.
- APA 7.
- Uso obligatorio de `Herramientas → Citas` en Google Docs.
- Toda cita debe aparecer en referencias y toda referencia debe usarse en el texto.
- Cada figura debe:
  - ser mencionada previamente;
  - tener número y descripción;
  - indicar fuente;
  - tener texto alternativo;
  - incluir referencia bibliográfica si no es propia.

### Estructura esperada

1. Portada.
2. Índice.
3. Resumen y Abstract.
4. Presentación del tema.
5. Glosario.
6. Diagnóstico o problemática.
7. Objetivos.
8. Marco teórico.
9. Propuesta de solución:
   - alcance;
   - diseño;
   - implementación;
   - pruebas.
10. Beneficios post-implementación.
11. Impacto económico.
12. Impacto social.
13. Impacto medioambiental — opcional.
14. Conclusión.
15. Bibliografía/referencias.
16. Anexos.

La guía espera referencias a pruebas funcionales, unitarias, de integración y aceptación, aunque no define cantidades ni cobertura mínima.

## 9. Plan de cierre recomendado

### 2026-07-24

- Obtener la consigna exacta y fecha de la entrega de agosto.
- Habilitar acceso al Gantt actual o exportarlo.
- Congelar el alcance de la entrega.
- Definir una única rama/commit de referencia.

### 2026-07-24 a 2026-07-27

- Corregir los guards multi-tenant faltantes.
- Agregar tests de regresión para cada ruta.
- Integrar y commitear `APP_DEBUG` y accesibilidad.
- Actualizar la auditoría técnica con el estado verdadero.

### 2026-07-28 a 2026-07-31

- Ejecutar el flujo E2E crítico.
- Completar una planilla de resultados reales para los 20 casos manuales.
- Incorporar al menos pruebas automatizadas de autenticación, obra, tarea, alerta y chatbot simulado.
- Preparar una base de demostración reproducible.
- Capturar las cuatro pantallas faltantes.

### 2026-08-01 a 2026-08-05

- Restaurar los 12 objetivos aprobados y su trazabilidad.
- Agregar “Evolución del alcance”.
- Decidir cómo presentar compras/costos.
- Actualizar las referencias documentales hasta `0043`, distinguir el estado local `0041` y revisar pruebas, seguridad y arquitectura.
- Completar análisis de campo, beneficios medibles e impacto económico.
- Corregir citas APA, Resumen, portada, índice, figuras y anexos.

### 2026-08-06 a 2026-08-07

- Regenerar y revisar el DOCX.
- Verificar índice, numeración, figuras y enlaces.
- Ensayar la demostración con cronómetro.
- Preparar contingencia: video/capturas y datos locales si falla una integración externa.
- Etiquetar la versión entregada.

Estas fechas deben ajustarse si la entrega ocurre antes del 2026-08-07.

## 10. Criterio de “listo para agosto”

El proyecto puede considerarse listo para la primera entrega cuando:

- la consigna de agosto esté satisfecha punto por punto;
- el Gantt muestre estado real y no solo fechas planeadas;
- exista un commit/tag único y reproducible;
- el flujo crítico E2E haya sido ejecutado y documentado;
- no queden rutas cross-tenant críticas conocidas;
- el IPI conserve los objetivos aprobados y explique sus ampliaciones;
- no queden `[COMPLETAR]` relevantes para el corte;
- cada afirmación técnica importante tenga código, prueba, captura o fuente que la respalde.
