# Informe de Proyecto Integrador — CONSTRUCTA

> **Cómo usar este documento.** El contenido sigue la estructura exacta de la *Plantilla IPI v2.1 – 2026* (UCC, Facultad de Ingeniería) y está redactado en tono formal e impersonal (3ª persona), listo para pegar en el Google Doc oficial. Los textos entre `«…»` y los bloques marcados **[COMPLETAR]** son datos que solo el equipo puede aportar (integrantes, directores, fechas, cifras reales). Las figuras están indicadas con un marcador `[FIGURA n: …]` para que se inserten las capturas/diagramas correspondientes. Las citas usan formato APA v7; la lista de referencias está al final.

---

## Portada

**Universidad Católica de Córdoba**
**Facultad de Ingeniería**

**Proyecto: CONSTRUCTA — Plataforma de gestión de obras de construcción con asistente de WhatsApp**

Informe Final de Grado

**Alumnos:**
- «Apellido, Nombre»
- «Apellido, Nombre»
- «Apellido, Nombre»

**Directores:**
- «Apellido, Nombre»
- «Apellido, Nombre»

«día» de «mes» de 2026
Córdoba — Argentina

---

## Resumen

La industria de la construcción gestiona la comunicación de obra de manera predominantemente informal —mensajes de WhatsApp, llamadas telefónicas y notas de papel—, lo que provoca que el avance real del trabajo en el campo no quede registrado ni vinculado al plan de obra. *(Introducción)*

Esta desconexión entre el plan y el campo genera retrabajo, demoras detectadas tarde y pérdida de trazabilidad: el responsable de cada tarea conoce el estado real, pero esa información no llega de forma estructurada a quien planifica. Las herramientas existentes (software de planificación tradicional) exigen que cada participante adopte una aplicación nueva, barrera que en obra rara vez se supera. *(Problemática)*

Se desarrolló CONSTRUCTA, una aplicación web de gestión de obras que conecta el cronograma con el campo a través de un asistente de WhatsApp: los responsables reportan el estado de sus tareas y registran notas de voz desde el número que ya usan, sin instalar ninguna aplicación. El sistema combina un backend de servicios (FastAPI, PostgreSQL, comunicación en tiempo real mediante Socket.IO) con un frontend de página única (React) e integra modelos de inteligencia artificial para transcribir y estructurar las notas de obra y para interpretar presupuestos de proveedores. *(Metodología — Solución)*

La solución implementada cubre el ciclo completo de gestión: planificación con diagrama de Gantt, dependencias y ruta crítica; carga masiva de tareas con una planilla de edición tipo hoja de cálculo; alertas automáticas de demoras; bitácora de obra por voz asistida por IA; gestión documental de presupuestos con lectura y comparación automática; y un repositorio de planos versionados consultables por WhatsApp. *(Resultados)*

Como conclusión, CONSTRUCTA demuestra que es viable reducir la fricción de adopción en obra manteniendo el canal de comunicación que los equipos ya utilizan, y que la incorporación de IA sobre ese canal convierte mensajes informales en información estructurada y accionable sobre el plan de obra. *(Conclusión)*

**Palabras clave:** gestión de obras, comunicación de obra, WhatsApp, inteligencia artificial, planificación, ruta crítica.

## Abstract

The construction industry manages on-site communication mostly informally —WhatsApp messages, phone calls and paper notes—, which means that the real progress of field work is neither recorded nor linked to the work plan. *(Introduction)*

This disconnection between plan and field causes rework, delays detected too late and loss of traceability: the person responsible for each task knows the real status, but that information never reaches the planner in a structured way. Existing tools (traditional planning software) require every participant to adopt a new application, a barrier rarely overcome on a construction site. *(Problem)*

CONSTRUCTA was developed, a web application for construction management that connects the schedule with the field through a WhatsApp assistant: task owners report task status and record voice notes from the number they already use, without installing any app. The solution combines a service backend (FastAPI, PostgreSQL, real-time communication via Socket.IO) with a single-page frontend (React) and integrates artificial-intelligence models to transcribe and structure field notes and to interpret supplier quotes. *(Methodology — Solution)*

The implemented solution covers the full management cycle: planning with a Gantt chart, dependencies and critical path; bulk task entry through a spreadsheet-like grid; automatic delay alerts; AI-assisted voice work log; document management of quotes with automatic reading and comparison; and a repository of versioned blueprints queryable via WhatsApp. *(Results)*

In conclusion, CONSTRUCTA shows that it is feasible to reduce on-site adoption friction by keeping the communication channel teams already use, and that adding AI on top of that channel turns informal messages into structured, actionable information about the work plan. *(Conclusion)*

**Keywords:** construction management, on-site communication, WhatsApp, artificial intelligence, planning, critical path.

---

## Presentación del tema

El presente proyecto integrador aborda la gestión de la información en obras de construcción, con foco en el vínculo entre la planificación y la ejecución en el campo. En el sector, la planificación suele realizarse en herramientas de escritorio (planillas de cálculo o software de planificación), mientras que la comunicación diaria de obra ocurre por canales informales como la mensajería instantánea. Esta separación entre dónde se planifica y dónde se comunica el avance constituye el eje del proyecto.

El propósito de CONSTRUCTA es **conectar el plan de obra con el campo sin obligar a los participantes a cambiar su forma de comunicarse**. La propuesta de valor que guía el diseño se resume en que el equipo "sigue planificando igual que antes" mientras la plataforma se encarga de capturar, estructurar y registrar lo que ocurre en la obra a través del canal que los responsables ya utilizan a diario.

El tema es relevante porque la construcción es una actividad económica intensiva en coordinación, donde una demora o un dato no comunicado a tiempo se propaga al resto del cronograma y se traduce en costos. Reducir la fricción de adopción de una herramienta de gestión —principal motivo por el que muchas soluciones fracasan en obra— es, en sí mismo, una oportunidad de mejora con impacto directo en la productividad del sector.

> **Nota:** la problemática aquí planteada no constituye un problema en sentido estricto, sino una oportunidad de mejora frente a una demanda insatisfecha: la falta de registro estructurado de la comunicación de obra.

---

## Glosario

Se definen los términos específicos del dominio de la construcción y de la operación de obra necesarios para la comprensión del informe.

- **Obra:** proyecto de construcción gestionado de forma integral (cronograma, equipo, presupuesto y documentación).
- **Jefe de obra:** responsable de la conducción técnica de la obra; coordina el avance y la asignación de trabajos.
- **Administrador de obra:** persona que, bajo el jefe de obra, concurre con mayor frecuencia al sitio y releva el avance.
- **Responsable (de tarea):** persona a cargo de la ejecución de una tarea específica; es el contacto del asistente de WhatsApp para reportar su estado.
- **Comitente:** cliente o mandante de la obra para quien se ejecuta el trabajo.
- **Rubro / disciplina:** categoría técnica del trabajo o de la documentación (por ejemplo, electricidad, sanitarios, estructura, arquitectura).
- **Ruta crítica:** secuencia de tareas dependientes cuya demora afecta directamente la fecha de finalización de la obra (método CPM, *Critical Path Method*).
- **Línea base (baseline):** fotografía del cronograma planificado contra la cual se compara el avance real.
- **WBS (Work Breakdown Structure):** estructura de descomposición del trabajo en tareas y subtareas.
- **Bitácora de obra:** registro cronológico de los hechos relevantes ocurridos en la obra.
- **Cómputo y presupuesto:** estimación de cantidades de materiales y costos asociados a una obra.

> Conforme a la guía, no se incluyen términos de uso general en ingeniería de software (por ejemplo, *backend*, *frontend* o base de datos), que se asumen conocidos por el lector técnico.

---

## Diagnóstico (Problemática)

**Estado del arte (contexto actual).** En la operación cotidiana de una obra conviven dos mundos que rara vez se tocan. Por un lado, la **planificación**: el cronograma, las fechas y las dependencias se construyen en software de escritorio o planillas de cálculo. Por el otro, la **comunicación de campo**: el avance, los problemas, las decisiones y los pedidos circulan por WhatsApp, llamadas y notas informales. El responsable que está en el sitio conoce el estado real de cada tarea, pero ese conocimiento permanece en su teléfono y no se traslada de forma estructurada al plan.

**Impacto.** Esta desconexión produce varios efectos negativos sobre los interesados:

- **Pérdida de trazabilidad:** lo acordado por mensajería no queda asociado a la tarea ni a la obra; cuando surge un conflicto, no hay un registro consultable.
- **Demoras detectadas tarde:** sin un mecanismo que vincule el reporte de campo con el cronograma, los atrasos se descubren cuando ya impactaron a tareas posteriores.
- **Retrabajo de carga:** quien planifica debe transcribir manualmente a la herramienta de gestión lo que recibió por mensajes, duplicando esfuerzo y abriendo la puerta a errores.
- **Documentación dispersa:** planos y presupuestos circulan por correo y chats; en obra es habitual trabajar sobre una versión desactualizada de un plano.

**Causa raíz: la fricción de adopción.** Las herramientas de gestión existentes exigen que *cada* participante —incluido el oficial o el contratista que solo necesita reportar "terminé el contrapiso"— instale, aprenda y use una aplicación nueva. En el contexto de obra, esa barrera rara vez se supera, por lo que las herramientas terminan siendo utilizadas únicamente por quien planifica y se desactualizan apenas la obra avanza.

**Oportunidad.** Existe la oportunidad de capturar la información de campo **sin pedirle al equipo que cambie de canal**: si el responsable puede reportar desde el WhatsApp que ya usa, y ese reporte se conecta automáticamente con el plan, se elimina la fricción de adopción y se cierra el ciclo entre planificación y ejecución. Sobre ese canal, además, la incorporación de inteligencia artificial permite transformar mensajes informales (incluidas notas de voz) en datos estructurados y acciones sugeridas sobre el cronograma.

El proyecto se dirige a dos perfiles de usuario representativos del sector: el **arquitecto o profesional independiente** que concurre él mismo a la obra, y la **empresa constructora** con una estructura de jefe de obra, administrador de obra y profesionales, donde el administrador es quien más frecuentemente está en el sitio.

---

## Objetivos

### Objetivo global

Desarrollar una plataforma de gestión de obras de construcción que conecte la planificación con la ejecución en el campo, reduciendo la fricción de adopción mediante un asistente de WhatsApp que permita a los responsables reportar el avance y registrar información de obra desde el canal que ya utilizan, y que incorpore inteligencia artificial para estructurar esa información y asistir la toma de decisiones.

### Objetivos específicos

1. Diseñar e implementar la gestión integral de obras: alta de obra, cronograma de tareas con fechas, dependencias entre tareas (cuatro tipos: FS, SS, FF, SF), subtareas (WBS) y calendario laboral.
2. Implementar la visualización del cronograma mediante un diagrama de Gantt interactivo con cálculo de ruta crítica (CPM), línea base y reprogramación en cascada.
3. Desarrollar un mecanismo de carga de tareas de baja fricción mediante una planilla de edición con gestos equivalentes a una hoja de cálculo (selección de rangos, relleno por arrastre, copiar/pegar bloques) e importación desde Excel y MS Project.
4. Construir un asistente de WhatsApp que identifique al emisor, permita a los responsables reportar el estado de sus tareas y registre notas de voz de obra.
5. Integrar inteligencia artificial para transcribir las notas de voz y producir un resumen con acciones sugeridas sobre el plan (bitácora de obra).
6. Implementar un módulo de gestión documental de presupuestos de proveedores con lectura automática mediante IA, comparación y detección de inconsistencias.
7. Implementar un repositorio de planos versionados, consultable por los responsables a través del asistente de WhatsApp.
8. Generar un sistema de alertas automáticas (tareas vencidas, bloqueadas, sin responsable) con notificación en tiempo real.
9. Implementar el aislamiento de datos por empresa (arquitectura multi-inquilino) y un esquema de planes y límites de uso.

### Tabla de trazabilidad (objetivos → evidencia)

| Objetivo específico | Evidencia de cumplimiento |
|---|---|
| 1. Gestión integral de obras | Módulos de obras, tareas, dependencias M2M, subtareas y calendario laboral implementados; migraciones de base de datos hasta la 0030. |
| 2. Gantt + CPM + baseline + cascada | Componente de cronograma con flechas de dependencia, toggle de ruta crítica y línea base; endpoint de ruta crítica; reprogramación en cascada con vista previa. |
| 3. Planilla de baja fricción | Vista de planilla con selección de rangos, relleno por arrastre con encadenado de fechas, copiar/pegar y deshacer; importación de Excel/CSV/MS Project. |
| 4. Asistente de WhatsApp | Webhook de mensajería; identificación de responsables y de staff por número; máquina de conversación para reporte de estado. |
| 5. Bitácora de obra con IA | Pipeline audio → transcripción → análisis con modelo de lenguaje → resumen y sugerencias aplicables. |
| 6. Presupuestos con IA | Carga de PDF/imagen/Excel/texto, extracción estructurada, comparación con recomendación e inconsistencias. |
| 7. Planos versionados | Carga con versionado por obra/disciplina; consulta y envío por WhatsApp de la última versión vigente. |
| 8. Alertas automáticas | Servicio de evaluación de riesgos por obra; cinco tipos de alerta; emisión en tiempo real por Socket.IO. |
| 9. Multi-inquilino y planes | Aislamiento por *tenant* en obras, responsables, alertas y usuarios; planes con límites y respuesta HTTP 402 al superarlos. |

---

## Marco teórico

### 1. Contexto general del problema

La gestión de proyectos de construcción se apoya en disciplinas consolidadas de la dirección de proyectos, en particular la planificación temporal mediante redes de actividades. El **método de la ruta crítica (CPM)** permite identificar, dentro de un conjunto de tareas con dependencias, la secuencia cuya demora afecta directamente la fecha de finalización del proyecto (Kelley & Walker, 1959). La representación habitual del cronograma es el **diagrama de Gantt**, que dispone las tareas sobre una línea de tiempo y permite visualizar duraciones, solapamientos y dependencias.

En la práctica del sector, sin embargo, la planificación formal coexiste con procedimientos informales de seguimiento. El relevamiento del avance suele realizarse por comunicación verbal o mensajería, y su traslado al plan depende de la carga manual por parte de quien planifica. Este procedimiento actual —que la solución propuesta busca reemplazar— es la principal fuente de pérdida de información y de desactualización del cronograma.

### 2. Análisis de campo

El proyecto se orientó a partir de la observación de la operación de dos perfiles de usuario: el profesional independiente que concurre a la obra y la empresa constructora con estructura jerárquica (jefe de obra, administrador de obra, profesionales). De esa observación se desprende un requisito transversal: **cualquier solución debe minimizar la cantidad de aplicaciones nuevas que el equipo de campo debe adoptar**, dado que la adopción es el principal punto de falla de las herramientas de gestión en obra.

> **[COMPLETAR]** Si la cátedra lo requiere, incorporar aquí el detalle del análisis de campo (encuestas o entrevistas a profesionales del sector, cantidad de participantes y principales hallazgos). En caso de no haberse realizado un relevamiento formal, indicarlo y justificar la decisión a partir de la experiencia directa del equipo en el dominio.

### 3. Opciones similares en el mercado

En el mercado existen diversas categorías de herramientas que abordan parcialmente la problemática:

- **Software de planificación tradicional** (por ejemplo, planificadores de cronograma de escritorio): potentes en planificación y ruta crítica, pero orientados al escritorio y desconectados de la comunicación de campo; requieren capacitación y no son utilizados por el personal de obra.
- **Plataformas de gestión de la construcción** (suites internacionales de *construction management*): cubren múltiples procesos, pero implican un costo y una complejidad de implementación elevados, y exigen que todos los participantes adopten la plataforma.
- **Herramientas genéricas de gestión de tareas** (tableros tipo *kanban* y similares): flexibles y de bajo costo, pero carecen de las capacidades propias de la planificación de obra (ruta crítica, línea base, cómputo) y tampoco resuelven el reporte desde el campo.
- **Comunicación informal por mensajería:** es el "competidor" real más extendido; su ventaja es la adopción nula-friccional, y su desventaja es la total ausencia de estructura, trazabilidad y conexión con el plan.

La carencia común a estas alternativas es la **falta de un puente de baja fricción entre el plan y el campo**: o bien priorizan la planificación y descuidan la captura de campo, o bien priorizan la comunicación y carecen de estructura. CONSTRUCTA se posiciona en ese espacio, tomando como canal de campo el mismo que el equipo ya utiliza.

### 4. Tecnologías investigadas

Para la construcción de la solución se evaluaron y seleccionaron las siguientes tecnologías:

- **Backend — API de servicios:** se adoptó FastAPI (framework web de Python) por su soporte nativo de asincronismo y su validación de datos por tipos, frente a alternativas síncronas. La persistencia se resolvió con SQLAlchemy 2.0 en modo asíncrono sobre PostgreSQL, motor relacional robusto y de licencia abierta.
- **Tiempo real:** se incorporó Socket.IO para la comunicación bidireccional (presencia de usuarios, alertas y edición colaborativa), frente a un esquema de sondeo periódico que habría sido menos eficiente.
- **Frontend — aplicación de página única:** se utilizó React con TypeScript y Vite, por su madurez, su tipado estático y la velocidad de su entorno de desarrollo.
- **Mensajería:** se integró la API de WhatsApp a través de Twilio, por ser un proveedor consolidado con soporte de mensajes y de envío de archivos multimedia.
- **Inteligencia artificial:** se evaluó el uso de modelos de lenguaje de gran escala para dos tareas distintas —estructuración de texto y comprensión de documentos—, seleccionando los modelos de la familia Claude (Anthropic) por su soporte de *structured outputs* (salida con esquema JSON garantizado) y de lectura nativa de documentos PDF e imágenes. Para la transcripción de voz a texto se evaluó el uso de modelos de reconocimiento automático del habla orientados al español.
- **Correo transaccional:** se integró un proveedor de correo (Brevo) para las invitaciones de equipo.

> Toda otra información de sustento se incorpora en la sección siguiente (Propuesta de solución).

---

## Propuesta de solución

La propuesta de solución consiste en una plataforma web —CONSTRUCTA— compuesta por un backend de servicios, un frontend de página única y un asistente conversacional sobre WhatsApp, integrada con modelos de inteligencia artificial. A continuación se detalla el alcance funcional, el diseño, la implementación y las pruebas.

### Alcance funcional

#### Requerimientos funcionales (qué entra)

- **Gestión de obras:** alta mediante asistente de cuatro pasos (datos, responsables, tareas, confirmación), edición, estados (planificada, en progreso, pausada, completada, cancelada) y datos del comitente.
- **Gestión de tareas:** creación, edición, eliminación lógica; fechas de inicio y fin; porcentaje de avance; hitos; subtareas (WBS); dependencias entre tareas en sus cuatro tipos (Fin–Inicio, Inicio–Inicio, Fin–Fin, Inicio–Fin) con desfase (*lag*).
- **Visualización del cronograma:** diagrama de Gantt con flechas de dependencia, ruta crítica, línea base y reprogramación automática en cascada con vista previa.
- **Planilla de tareas:** edición tipo hoja de cálculo con selección de celdas y rangos, relleno por arrastre (con encadenado de fechas), copiar/pegar de bloques, deshacer e importación desde Excel, CSV y MS Project.
- **Equipo de la empresa:** directorio global de responsables; asignación a obras; un responsable asignado a una tarea queda automáticamente vinculado al equipo de la obra.
- **Asistente de WhatsApp:** identificación del emisor (responsable o personal de la empresa); reporte de estado de tareas; registro de notas de voz de obra; consulta de planos.
- **Bitácora de obra con IA:** transcripción de la nota de voz, generación de un resumen y de puntos clave, y sugerencia de acciones aplicables sobre el plan (mover fechas, crear tareas, cambiar estados).
- **Gestión de presupuestos con IA:** carga de presupuestos de proveedores en múltiples formatos, extracción estructurada de sus datos, comparación entre presupuestos y detección de inconsistencias.
- **Gestión de planos:** carga con versionado por obra y disciplina; consulta y envío de la última versión vigente por WhatsApp.
- **Alertas:** evaluación automática de riesgos (tareas vencidas, demoradas/bloqueadas, sin responsable, alto porcentaje de vencidas) con notificación en tiempo real.
- **Materiales, presupuesto y compras:** materiales por tarea, presupuesto por obra (estimado vs. real) y generación de órdenes de compra a proveedores.
- **Administración:** roles (administrador / colaborador), invitaciones por correo, panel de uso del plan y aislamiento de datos por empresa.

#### Fuera de alcance (qué queda fuera)

- Integración contable o de facturación con sistemas externos.
- Aplicación móvil nativa (el acceso de campo es por WhatsApp; la aplicación web es responsiva).
- Pasarela de pago para el cobro de los planes (el sistema modela los límites del plan, pero no procesa pagos).
- Notificación al jefe/administrador ante la respuesta de un responsable a un recordatorio (funcionalidad analizada, no implementada).

> *(Ejemplo de requerimiento, según la guía)* «El sistema debe permitir que un responsable registre una nota de voz de obra desde WhatsApp y que esta quede asociada a la obra correspondiente con un resumen generado automáticamente.»
>
> **[FIGURA 1: Diagrama de casos de uso de CONSTRUCTA — actores (Administrador, Responsable, Asistente de WhatsApp) y casos de uso principales.]**

### Diseño

#### Pantallas (interfaz de usuario)

La aplicación web se organiza por estado de navegación (sin enrutador de URL): un portafolio de obras y, al seleccionar una, una vista de detalle con pestañas (Resumen, Tareas, Responsables, Alertas, Historial, Presupuesto, Planos). El diseño visual emplea una identidad propia (paleta con naranja de acción `#FF6B35`, tipografías Plus Jakarta Sans y JetBrains Mono) con estilos en línea.

> **[FIGURA 2: Captura del portafolio de obras (panel principal).]**
> **[FIGURA 3: Captura del diagrama de Gantt con dependencias y ruta crítica.]**
> **[FIGURA 4: Captura de la planilla de tareas con selección de rango y relleno por arrastre.]**
> **[FIGURA 5: Captura del módulo de presupuestos (comparación con recomendación de IA).]**

#### Arquitectura del software

CONSTRUCTA adopta una **arquitectura cliente–servidor de tres capas**, desplegable en la nube:

- **Capa de presentación:** aplicación de página única (React + TypeScript), servida estáticamente y comunicada con el servidor por HTTP/JSON y por *websockets* (Socket.IO).
- **Capa de servicios (backend):** API REST construida con FastAPI, organizada en *routers* (endpoints), *services* (lógica de negocio), *repositories* (acceso a datos) y *schemas* (validación). El servidor expone, además, un *endpoint* de *webhook* que recibe los mensajes entrantes de WhatsApp.
- **Capa de datos:** base de datos relacional PostgreSQL, con esquema versionado mediante migraciones (Alembic, hasta la versión 0030).
- **Integraciones externas:** API de WhatsApp (Twilio), modelos de IA (Anthropic Claude y reconocimiento de voz), y correo transaccional (Brevo).

El aislamiento entre empresas se resuelve a nivel de aplicación con un identificador de inquilino (*tenant*) que filtra las consultas de obras, responsables, alertas y usuarios.

> **[FIGURA 6: Diagrama de arquitectura de tres capas con las integraciones externas.]**

#### Diseño de datos

El modelo de datos se compone, entre otras, de las siguientes entidades principales: `tenants` (empresas), `users` (usuarios con rol), `obras`, `tasks` (con auto-referencia para subtareas y tabla intermedia de dependencias), `responsibles`, `obra_team_members`, `alerts`, `historial_eventos` (registro append-only), `messages` y `conversation_sessions` (chatbot), `suppliers`, `task_materials`, `purchase_orders`, `budgets` (presupuestos con IA), `planos` y `bitacora_entries`.

> **[FIGURA 7: Diagrama entidad-relación (DER) del modelo de datos. Referencia: `docs/database.md`.]**

#### Patrones de diseño

- **Capas / separación de responsabilidades:** *router → service → repository* en el backend, aislando la lógica de negocio del acceso a datos.
- **Repositorio (Repository):** abstracción del acceso a datos sobre el ORM.
- **Máquina de estados:** el flujo conversacional del asistente de WhatsApp se modela como una secuencia de pasos con estado persistido (`conversation_sessions`).
- **Registro append-only:** el historial de eventos de obra es inmutable, garantizando trazabilidad.

### Implementación

El desarrollo se dividió en módulos lógicos que se construyeron y ensamblaron de manera incremental. La cronología completa del desarrollo se documenta en `docs/documentacion.md`.

- **Módulo de autenticación y multi-inquilino:** registro de empresa, inicio de sesión con JWT, roles e invitaciones; aislamiento por *tenant*.
- **Módulo de obras y tareas:** CRUD de obras y tareas, dependencias, subtareas, calendario laboral y reprogramación en cascada.
- **Módulo de cronograma (Gantt):** visualización interactiva, ruta crítica, línea base.
- **Módulo de planilla:** edición tipo hoja de cálculo e importación/exportación (Excel, CSV, MS Project).
- **Módulo de alertas y tiempo real:** evaluación de riesgos y emisión por Socket.IO; presencia de usuarios.
- **Módulo de asistente de WhatsApp:** *webhook*, identificación de emisores, reporte de estado, consulta de planos y registro de notas de voz.
- **Módulo de bitácora con IA:** transcripción de audio y análisis con modelo de lenguaje (salida estructurada: resumen, puntos clave y sugerencias aplicables).
- **Módulo de presupuestos con IA:** lectura de documentos de proveedores, extracción estructurada, comparación y detección de inconsistencias.
- **Módulo de planos:** carga versionada y consulta por WhatsApp.
- **Módulo de materiales, presupuesto y compras:** cómputo por tarea, presupuesto por obra y órdenes de compra.

### Pruebas

La estrategia de verificación combinó distintos niveles:

- **Plan de pruebas:** se mantiene un conjunto de casos de prueba manuales documentados en `docs/casos_de_prueba.md`.
- **Pruebas funcionales y de aceptación:** cada módulo se verificó ejecutando la aplicación en el navegador contra el backend real, comprobando el comportamiento esperado de las interacciones (por ejemplo, el relleno por arrastre con encadenado de fechas persistiendo en la base, o el flujo completo de la bitácora por voz).
- **Pruebas de integración:** se verificaron de extremo a extremo los flujos que atraviesan varias capas e integraciones, como el envío de una nota de voz por WhatsApp → transcripción → análisis con IA → registro en la bitácora, y la lectura y comparación de presupuestos con el modelo de lenguaje.
- **Verificación de regresiones:** ante cada cambio se ejecutó la verificación de tipos (`tsc`) y la compilación de producción del frontend, y se realizó una auditoría general de la aplicación documentada en `docs/auditoria-general.md`.

> **[COMPLETAR]** Si la cátedra exige pruebas unitarias automatizadas con cobertura, dejar constancia del estado actual y, en su caso, del plan para incorporarlas (por ejemplo, *pytest* en el backend y *Vitest*/*Playwright* en el frontend).

---

## Beneficios post-implementación

- **Reducción de la fricción de adopción:** el personal de campo reporta desde el WhatsApp que ya utiliza, sin instalar ni aprender una aplicación nueva.
- **Trazabilidad de la comunicación de obra:** lo que antes se perdía en chats queda registrado, asociado a la obra y a la tarea, en un historial append-only.
- **Detección temprana de desvíos:** las alertas automáticas y la ruta crítica permiten anticipar el impacto de una demora antes de que afecte a tareas posteriores.
- **Disminución del retrabajo de carga:** la información de campo llega estructurada (transcrita y resumida por IA), evitando la transcripción manual.
- **Mejor toma de decisiones en compras:** la lectura y comparación automática de presupuestos permite elegir proveedor ponderando precio, plazo y condiciones, y advierte inconsistencias.
- **Acceso a la documentación vigente desde el campo:** los responsables obtienen la última versión de un plano por WhatsApp, evitando trabajar sobre planos desactualizados.

> **[COMPLETAR]** Cuantificar los beneficios con métricas objetivo cuando se disponga de datos de uso real (por ejemplo, porcentaje de reducción del tiempo de carga de avances, o cantidad de notas de obra registradas por semana).

---

## Impacto económico (estudio de costos)

> **[COMPLETAR con cifras reales del equipo.]** A continuación se presenta la estructura del estudio de costos con valores de referencia que deben ajustarse a la realidad del proyecto y del mercado al momento de la entrega.

**Costos de implementación (desarrollo).** Corresponden al esfuerzo de ingeniería para construir la plataforma. Se estiman a partir de las horas-persona invertidas por el equipo durante el desarrollo del proyecto integrador, valorizadas a «valor hora» de referencia del mercado de desarrollo de software en Argentina.

**Costos de operación (mensuales, por empresa cliente).**

| Concepto | Detalle | Costo de referencia |
|---|---|---|
| Hosting backend + base de datos | Plataforma en la nube (p. ej. Railway/Render) | «USD/mes» |
| Hosting frontend | Servido estático (p. ej. Vercel) | «USD/mes (puede ser nulo)» |
| Mensajería WhatsApp | Por mensaje/conversación (Twilio) | «según volumen» |
| Modelos de IA | Transcripción de voz y análisis de texto/documentos | «~USD por operación» |
| Correo transaccional | Invitaciones de equipo | «según volumen» |

A modo de referencia verificada durante las pruebas, el costo de procesar una nota de voz de obra (transcripción + análisis con IA) se ubicó en el orden de **un centavo de dólar por audio de dos minutos**, lo que indica que el costo variable de IA por uso es marginal frente al valor que aporta.

**Ahorros potenciales para el cliente.** El principal ahorro es el **tiempo de coordinación** que hoy se pierde en transcribir avances, perseguir respuestas y reconstruir lo acordado, además del costo evitado por **demoras detectadas tarde**.

**Modelo de ingresos.** El sistema contempla planes por suscripción (Básico, Pro y Enterprise) con límites de obras, usuarios y tareas, lo que define el potencial de retorno de la inversión.

> El presente apartado debe completarse con un estudio serio y específico (horas de desarrollo reales, valores de mercado vigentes y proyección de retorno de inversión), conforme a la exigencia de la cátedra.

---

## Impacto social

- **Beneficio o impacto positivo general:** la mejora en la coordinación y la trazabilidad de las obras contribuye a reducir conflictos entre las partes (empresa, comitente, contratistas) y a profesionalizar la gestión en un sector tradicionalmente informal.
- **Segmentos de la población beneficiados:** pequeñas y medianas empresas constructoras y profesionales independientes (arquitectos), que acceden a capacidades de planificación antes reservadas a grandes organizaciones con software costoso.
- **Solidaridad y apoyo a segmentos vulnerables / Inclusión y reducción de brechas:** al usar WhatsApp como canal de campo, la herramienta es accesible para personal de obra con baja familiaridad tecnológica, sin requerir la compra de equipamiento ni capacitación específica; esto reduce la brecha digital en la adopción de tecnología en la construcción.

> **[COMPLETAR]** Profundizar con datos del contexto local si la cátedra lo solicita.

---

## Impacto medioambiental (opcional)

- **Minimización de residuos y desperdicios:** la digitalización de planos, presupuestos y la bitácora reduce el uso de papel en obra.
- **Uso eficiente de recursos:** la mejor planificación (ruta crítica, detección temprana de desvíos) tiende a reducir el retrabajo y el desperdicio de materiales asociado a errores de coordinación.
- **Impacto indirecto en la conciencia ambiental:** la trazabilidad del consumo de materiales (módulo de cómputo y compras) habilita, a futuro, el seguimiento del uso de recursos por obra.

---

## Conclusión

El proyecto CONSTRUCTA permitió construir una plataforma funcional que aborda la desconexión entre la planificación y la ejecución en obra. Se cumplieron los objetivos específicos planteados: la gestión integral de obras y tareas, la visualización del cronograma con ruta crítica y línea base, la carga de baja fricción, el asistente de WhatsApp con identificación de emisores, la bitácora de obra asistida por IA, la gestión de presupuestos con lectura y comparación automática, el repositorio de planos consultable por WhatsApp, el sistema de alertas y el aislamiento multi-inquilino con planes.

Entre los principales aprendizajes del desarrollo se destacan: la importancia de **minimizar la fricción de adopción** como criterio de diseño rector; el valor de los modelos de lenguaje con **salida estructurada** para convertir lenguaje natural (mensajes y notas de voz) en datos accionables de forma confiable; y la necesidad de **verificar en condiciones reales** —ejecutando la aplicación y los flujos de integración— para detectar problemas que las verificaciones de compilación no revelan.

Como objetivos no cumplidos o pendientes se identifican: la notificación automática al jefe o administrador de obra cuando un responsable responde a un recordatorio (funcionalidad analizada y diseñada, no implementada), la pasarela de pago para el cobro efectivo de los planes, y la incorporación de pruebas unitarias automatizadas con métrica de cobertura.

> **[COMPLETAR]** Agregar reflexiones personales del equipo sobre el proceso, si corresponde.

---

## Bibliografía / Referencias

> Listado en formato APA v7. Se priorizan fuentes verificables (documentación oficial y bibliografía técnica). **[COMPLETAR]** con las fuentes académicas del dominio que se hayan utilizado y con los datos de acceso (fecha de consulta) según exija la cátedra. Recordá usar la herramienta de Citas de Google Docs (Tools → Citations) y citar en el texto cada fuente que aparezca aquí.

- Anthropic. (2026). *Claude API documentation*. Anthropic. https://docs.anthropic.com
- FastAPI. (2026). *FastAPI documentation*. https://fastapi.tiangolo.com
- Kelley, J. E., & Walker, M. R. (1959). Critical-path planning and scheduling. *Proceedings of the Eastern Joint Computer Conference*, 160–173.
- Meta Platforms. (2026). *WhatsApp Business Platform documentation*. https://developers.facebook.com/docs/whatsapp
- PostgreSQL Global Development Group. (2026). *PostgreSQL documentation*. https://www.postgresql.org/docs/
- Project Management Institute. (2021). *A guide to the project management body of knowledge (PMBOK guide)* (7th ed.). PMI.
- React. (2026). *React documentation*. Meta. https://react.dev
- SQLAlchemy. (2026). *SQLAlchemy 2.0 documentation*. https://docs.sqlalchemy.org
- Twilio. (2026). *Twilio API for WhatsApp documentation*. https://www.twilio.com/docs/whatsapp

---

## Anexos

Información suplementaria, no necesaria para el entendimiento mínimo del proyecto:

- **Anexo A — Bitácora de desarrollo completa:** `docs/documentacion.md` (registro cronológico de avances, decisiones y validaciones).
- **Anexo B — Esquema de base de datos:** `docs/database.md` (detalle de tablas, columnas y relaciones).
- **Anexo C — Casos de prueba manuales:** `docs/casos_de_prueba.md`.
- **Anexo D — Auditorías de la aplicación:** `docs/auditoria-general.md`, `docs/auditoria-ux.md`, `docs/auditoria-flujo-alta.md`.
- **Anexo E — Repositorio de código:** «URL del repositorio».
