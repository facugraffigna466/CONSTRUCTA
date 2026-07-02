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
- **Hito:** punto de control sin duración en el cronograma que marca un evento significativo (por ejemplo, "fin de estructura").
- **Desfase (lag):** tiempo de espera o adelanto, en días, aplicado a una dependencia entre dos tareas.
- **Holgura (float):** margen de tiempo que una tarea puede demorarse sin afectar la fecha de fin de la obra; las tareas de la ruta crítica tienen holgura nula.
- **Orden de compra:** documento que formaliza el pedido de materiales o servicios a un proveedor.
- **Empresa (inquilino):** cada empresa cliente del sistema, cuyos datos (obras, equipo, presupuestos) quedan aislados del resto.

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
| 1. Gestión integral de obras | Módulos de obras, tareas, dependencias M2M, subtareas y calendario laboral implementados; migraciones de base de datos hasta la 0038. |
| 2. Gantt + CPM + baseline + cascada | Componente de cronograma con flechas de dependencia, toggle de ruta crítica y línea base; endpoint de ruta crítica; reprogramación en cascada con vista previa. |
| 3. Planilla de baja fricción | Vista de planilla con selección de rangos, relleno por arrastre con encadenado de fechas, copiar/pegar y deshacer; importación de Excel/CSV/MS Project. |
| 4. Asistente de WhatsApp | Webhook de mensajería; identificación de responsables y de staff por número; máquina de conversación para reporte de estado. |
| 5. Bitácora de obra con IA | Cadena audio → transcripción (`gpt-4o-mini-transcribe`) → análisis con modelo de lenguaje (Claude Haiku 4.5, salida estructurada) → resumen, puntos clave y sugerencias aplicables. |
| 6. Presupuestos con IA | Carga de PDF/imagen/Excel/texto, extracción estructurada, comparación con recomendación e inconsistencias. Módulo de solicitudes de cotización: generación de PDF de solicitud, envío a proveedores por WhatsApp, recepción automática de respuestas PDF desde WhatsApp, análisis comparativo con IA (salida estructurada) y confirmación de proveedor con generación de orden de compra. |
| 7. Planos versionados | Carga con versionado por obra/disciplina; consulta y envío por WhatsApp de la última versión vigente. |
| 8. Alertas automáticas | Servicio de evaluación de riesgos por obra (vencidas, bloqueadas, sin responsable, alto porcentaje de vencimiento); seis tipos de alerta; emisión en tiempo real por Socket.IO y traza en el historial. |
| 9. Multi-inquilino y planes | Aislamiento por *tenant* en obras, responsables, alertas y usuarios; planes con límites y respuesta HTTP 402 al superarlos. |

---

## Marco teórico

### 1. Contexto general del problema

La gestión de proyectos de construcción se apoya en disciplinas consolidadas de la dirección de proyectos, en particular la planificación temporal mediante redes de actividades. El **método de la ruta crítica (CPM)** permite identificar, dentro de un conjunto de tareas con dependencias, la secuencia cuya demora afecta directamente la fecha de finalización del proyecto (Kelley & Walker, 1959). El método calcula, para cada tarea, sus fechas más tempranas y más tardías de inicio y fin (mediante un recorrido hacia adelante y otro hacia atrás sobre la red), y de allí su **holgura**; las tareas con holgura nula conforman la ruta crítica. La representación habitual del cronograma es el **diagrama de Gantt**, atribuido a Henry L. Gantt a comienzos del siglo XX, que dispone las tareas sobre una línea de tiempo y permite visualizar duraciones, solapamientos y dependencias.

La dirección de proyectos sistematiza, además, otros conceptos que la solución adopta: la **estructura de descomposición del trabajo (WBS)**, que organiza el alcance en tareas y subtareas jerárquicas; los **cuatro tipos de relación de precedencia** entre actividades —Fin–Inicio (FS), Inicio–Inicio (SS), Fin–Fin (FF) e Inicio–Fin (SF)—, eventualmente con un desfase (*lag*); y la **línea base**, fotografía del cronograma aprobado que sirve de referencia para medir desvíos durante la ejecución (Project Management Institute, 2021).

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
- **Inteligencia artificial — modelos de lenguaje:** se evaluó el uso de modelos de lenguaje de gran escala (LLM) para dos tareas distintas —estructuración de texto y comprensión de documentos—, seleccionando el modelo Claude Haiku 4.5 (Anthropic) por su soporte de *structured outputs* (salida forzada a un esquema JSON, lo que garantiza que la respuesta del modelo sea procesable por el sistema sin análisis frágil de texto libre) y de lectura nativa de documentos PDF e imágenes. La técnica de salida estructurada es central para la confiabilidad de la solución: convierte lenguaje natural —mensajes y notas de voz— en datos validados contra un esquema, en lugar de texto a interpretar manualmente.
- **Inteligencia artificial — reconocimiento del habla:** para la transcripción de voz a texto se incorporó un modelo de reconocimiento automático del habla (ASR) orientado al español rioplatense (`gpt-4o-mini-transcribe`), de bajo costo por minuto, que constituye el primer eslabón del procesamiento de las notas de voz de obra.
- **Comunicación en tiempo real y orientada a eventos:** la solución combina dos mecanismos asíncronos. Por un lado, un *webhook* HTTP recibe los mensajes entrantes de WhatsApp (arquitectura orientada a eventos: el proveedor de mensajería notifica al sistema). Por el otro, *websockets* (Socket.IO) empujan al navegador, sin sondeo, los cambios de estado (presencia, alertas y edición colaborativa).
- **Correo transaccional:** se integró un proveedor de correo (Brevo) para las invitaciones de equipo.

> Toda otra información de sustento se incorpora en la sección siguiente (Propuesta de solución).

---

## Propuesta de solución

La propuesta de solución consiste en una plataforma web —CONSTRUCTA— compuesta por un backend de servicios, un frontend de página única y un asistente conversacional sobre WhatsApp, integrada con modelos de inteligencia artificial. A continuación se detalla el alcance funcional, el diseño, la implementación y las pruebas.

### Alcance funcional

#### Requerimientos funcionales (qué entra)

- **Gestión de obras:** alta mediante asistente de cuatro pasos (datos, responsables, tareas, confirmación), edición y datos del comitente. El **estado de la obra** (planificada, en progreso, pausada, completada, cancelada) sigue un modelo **híbrido**: transiciona de forma **automática** según el avance de las tareas (pasa a *en progreso* cuando alguna tarea arranca y a *completada* cuando todas se terminan), mientras que las decisiones que no pueden inferirse —*pausar* y *reactivar*— se realizan de forma **manual**; los estados terminales no se modifican a mano.
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

#### Requerimientos no funcionales

- **Seguridad:** autenticación por tokens JWT, contraseñas almacenadas con *hashing*, control de acceso por rol (administrador / colaborador) y aislamiento estricto de los datos entre empresas (multi-inquilino). La eliminación es lógica (*soft delete*), preservando la información.
- **Usabilidad y baja fricción de adopción:** el personal de campo opera por WhatsApp sin instalar ninguna aplicación; la carga de datos en el escritorio reproduce los gestos de una hoja de cálculo. Es el requerimiento no funcional rector del proyecto.
- **Rendimiento:** el backend emplea entrada/salida asíncrona de extremo a extremo (FastAPI + SQLAlchemy *async*); los datos de una obra se cargan una sola vez al abrirla, y las actualizaciones de estado se propagan por *websockets* en lugar de sondeo.
- **Trazabilidad:** todo evento relevante de obra queda registrado en un historial inmutable (*append-only*), lo que garantiza un registro auditable y no repudiable.
- **Mantenibilidad:** separación en capas (router → service → repository), esquema de base de datos versionado con migraciones (Alembic) y tipado estático en backend (Python con anotaciones de tipo) y frontend (TypeScript).
- **Disponibilidad y escalabilidad:** backend sin estado de sesión en memoria (el estado conversacional se persiste en la base), apto para despliegue en la nube y escalado horizontal.
- **Costo de operación acotado:** el costo variable de IA por uso es marginal (del orden de un centavo de dólar por nota de voz; véase Impacto económico).

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
- **Capa de datos:** base de datos relacional PostgreSQL, con esquema versionado mediante migraciones (Alembic, hasta la versión 0038).
- **Integraciones externas:** API de WhatsApp (Twilio), modelos de IA (Anthropic Claude y reconocimiento de voz), y correo transaccional (Brevo).

El aislamiento entre empresas se resuelve a nivel de aplicación con un identificador de inquilino (*tenant*) que filtra las consultas de obras, responsables, alertas, usuarios y bitácora.

El sistema opera bajo dos flujos característicos:

1. **Flujo de aplicación web (petición–respuesta):** el navegador realiza llamadas HTTP/JSON a la API; el *router* valida la entrada con un esquema, delega la lógica en el *service*, este accede a los datos por el *repository*, y la respuesta vuelve al cliente. Cuando un cambio debe reflejarse en otros usuarios conectados (una nueva alerta, la presencia de un par, una edición concurrente), el servidor lo emite por Socket.IO sin que el cliente deba volver a consultar.

2. **Flujo de campo (orientado a eventos):** cuando un responsable envía un mensaje de WhatsApp, el proveedor de mensajería invoca el *webhook* del sistema. El servidor identifica al emisor por su número, recupera o crea su sesión de conversación y avanza la **máquina de estados** del asistente. Si el mensaje es una nota de voz, se dispara el procesamiento de inteligencia artificial (transcripción y análisis), cuyo resultado se persiste y se notifica en tiempo real a la aplicación web. De este modo, un hecho ocurrido en el campo actualiza el plan sin intervención manual.

> **[FIGURA 6: Diagrama de arquitectura de tres capas con las integraciones externas.]**

#### Diseño de datos

El modelo de datos, versionado en treinta y ocho migraciones (0001 a 0038), se organiza en torno a la entidad **obra** como agregado central y se compone de las siguientes entidades principales:

- **Identidad y organización:** `tenants` (empresas, con su `plan`), `users` (usuarios con rol y número de WhatsApp), `settings`.
- **Obra y planificación:** `obras` (con datos del comitente), `tasks` (con auto-referencia `parent_task_id` para subtareas y una tabla intermedia de dependencias que registra el tipo —FS/SS/FF/SF— y el desfase), `baselines` (líneas base de tareas), `calendar` (calendario laboral).
- **Equipo:** `responsibles` (directorio de personas) y `obra_team_members` (relación muchos-a-muchos entre responsables y obras, con rol).
- **Comunicación y campo:** `messages` y `conversation_sessions` (estado del asistente de WhatsApp), `bitacora_entries` (notas de voz con su transcripción, resumen y sugerencias), `historial` (registro de eventos *append-only*), `alerts`.
- **Compras y documentación:** `suppliers`, `task_materials`, `purchase_orders` (con sus ítems), `budgets` (presupuestos leídos por IA) y `planos` (documentación versionada).

El aislamiento entre empresas se materializa con la columna `tenant_id` en las entidades de cabecera. Las relaciones clave son: una empresa tiene muchos usuarios y muchas obras; una obra tiene muchas tareas, alertas, entradas de bitácora, presupuestos y planos; una tarea pertenece a una obra, puede tener una tarea padre, se relaciona con otras por dependencias y se asigna a un responsable.

> **[FIGURA 7: Diagrama entidad-relación (DER) del modelo de datos. Referencia: `docs/database.md`.]**

#### Patrones de diseño

- **Capas / separación de responsabilidades:** *router → service → repository* en el backend, aislando la lógica de negocio del acceso a datos.
- **Repositorio (Repository):** abstracción del acceso a datos sobre el ORM.
- **Máquina de estados:** el flujo conversacional del asistente de WhatsApp se modela como una secuencia de pasos con estado persistido (`conversation_sessions`).
- **Registro append-only:** el historial de eventos de obra es inmutable, garantizando trazabilidad.

### Implementación

**Enfoque de desarrollo.** La construcción se abordó de forma **incremental**, con una rama de control de versiones (Git) por cada etapa del plan, integrada al tronco principal tras su verificación. Cada cambio en el modelo de datos se materializó en una **migración** versionada (treinta y ocho en total, 0001 a 0038), de modo que el esquema de la base pudiera evolucionar de manera reproducible. La cronología completa del desarrollo, con sus decisiones y validaciones, se documenta en `docs/documentacion.md`.

**Magnitud de la implementación.** El backend expone alrededor de veintiséis grupos de *endpoints* (autenticación, obras, tareas, dependencias, ruta crítica, línea base, calendario, alertas, notificaciones, presencia, responsables, equipo de obra, bitácora, presupuestos, planos, proveedores, materiales, órdenes de compra, importación, exportación, *webhooks*, administración, entre otros), apoyados en torno a veintiún entidades de datos y diecisiete servicios de negocio. El frontend se organiza en una docena de pantallas y unos treinta y cinco componentes reutilizables.

A continuación se describen los módulos que componen la solución:

- **Módulo de autenticación y multi-inquilino:** registro de empresa, inicio de sesión con tokens JWT, gestión de roles (administrador / colaborador) e invitaciones de equipo por correo. Todas las consultas se filtran por el identificador de empresa (*tenant*), garantizando el aislamiento de datos. Incorpora un esquema de **planes** (Básico, Pro, Enterprise) con límites de obras, usuarios y tareas: al superarse un límite, la API responde con el código HTTP 402 (*Payment Required*) y el frontend ofrece la mejora de plan.
- **Módulo de obras y tareas:** alta de obra mediante asistente de cuatro pasos y gestión completa de tareas con fechas, porcentaje de avance, hitos, subtareas (WBS, vía `parent_task_id`) y dependencias en sus cuatro tipos (FS, SS, FF, SF) con desfase. Incluye la **reprogramación en cascada**: al modificar las fechas de una tarea con sucesoras, el sistema recorre el grafo de dependencias y ofrece una vista previa de las tareas afectadas antes de confirmar, registrando un único evento en el historial. Además, cuando una fecha de inicio o de fin cae en un día no laboral (fin de semana o feriado del calendario de la obra), el sistema la **ajusta automáticamente al día laboral más cercano** en lugar de rechazar la operación, e informa el ajuste realizado.
- **Módulo de cronograma (Gantt):** visualización interactiva del cronograma con arrastre y redimensionado de barras, vistas de semana, mes y trimestre y **zoom continuo** (gesto de pellizco del *trackpad* o Ctrl+rueda, anclado al punto bajo el cursor) que permite ajustar el nivel de detalle desde una tarea individual hasta la obra completa. Las **subtareas se agrupan inmediatamente debajo de su tarea padre** (jerarquía WBS) y las **dependencias** se hacen explícitas por partida doble: con flechas sobre la línea de tiempo y con una etiqueta en la columna de tareas (que se omite cuando la predecesora es la propia tarea padre, por redundante). Incluye **cálculo de ruta crítica (CPM)** y superposición de la **línea base** para comparar lo planificado con lo replanificado, además de edición y eliminación de tareas desde la propia fila.
- **Módulo de planilla de tareas:** vista de edición tipo hoja de cálculo con selección de celdas y rangos, relleno por arrastre con encadenado automático de fechas, copiar/pegar de bloques y deshacer. La planilla replica la experiencia de una hoja de cálculo real: **zoom continuo** (gesto de pellizco del *trackpad*, anclado al cursor) que revela más o menos celdas, una **grilla que se extiende más allá de los datos** —con desplazamiento hacia celdas vacías como en una hoja de cálculo—, alta de tareas escribiendo directamente sobre cualquier celda vacía e **inserción de filas en cualquier posición del orden** (que se persiste). El usuario puede **mostrar u ocultar columnas** según su necesidad; además de las de planificación, dispone de columnas opcionales de **hito**, **dependencias** y **costo de materiales** (esta última, un resumen que vincula la planilla con el presupuesto de la tarea). Se complementa con **importación** desde Excel, CSV y MS Project (mapeo de WBS, recursos y dependencias) y **exportación** a Excel, además de una plantilla descargable.
- **Módulo de alertas y tiempo real:** un servicio evalúa automáticamente los riesgos de cada obra (tareas vencidas, demoradas o bloqueadas, sin responsable, y alto porcentaje de vencimiento) y genera alertas de distintos tipos —tarea bloqueada, riesgo de demora, tarea vencida, sin respuesta, reprogramación solicitada y recepción de pedido—. Las alertas se emiten en tiempo real por Socket.IO y quedan trazadas en el historial. El mismo canal soporta la presencia de usuarios conectados y la edición colaborativa.
- **Módulo de asistente de WhatsApp:** un *webhook* recibe los mensajes entrantes; el sistema identifica al emisor (responsable de tareas o personal de la empresa) por su número y conduce la conversación mediante una **máquina de estados** (estados: reposo, selección de obra, selección de tarea, menú de estado y espera de fecha), persistida en la base. Permite reportar el estado de una tarea, registrar notas de voz y consultar planos.
- **Módulo de bitácora de obra con IA:** convierte una nota de voz en información estructurada mediante una cadena de procesamiento: el audio se transcribe con un modelo de reconocimiento del habla (`gpt-4o-mini-transcribe`) y el texto resultante se analiza con un modelo de lenguaje (Claude Haiku 4.5) configurado con **salida estructurada (JSON Schema)**. El análisis produce un resumen de dos a cuatro oraciones, una lista de puntos clave y un conjunto de **sugerencias aplicables** sobre el plan —reprogramar una tarea, crear una tarea, cambiar un estado o dejar una nota—, cada una con una cita del audio que la justifica. Si el audio no contiene nada accionable, no se fuerzan sugerencias. El modelo recibe el **calendario laboral** de la obra para proponer fechas en días hábiles, y las sugerencias se revisan y aplican (Sí/No) desde la aplicación —un módulo propio de cada obra— donde un indicador por obra señala las que quedan pendientes. Para no perder ninguna nota, si una nota de voz llega sin obra (un emisor con varias obras que no indicó cuál), el sistema le **recuerda automáticamente al emisor cada 30 minutos** —en horario laboral, hasta 48 horas— que la asigne; y si aun así no responde, la nota queda visible en una sección **"Sin asignar"** para que el jefe de obra la asigne manualmente, garantizando la trazabilidad. Antes de aplicar una sugerencia, el jefe puede **editarla** (ajustar fechas, título, responsable o estado): la IA propone y él decide. Cuando una sugerencia se aplica, el sistema **le confirma por WhatsApp a quien envió la nota** qué se hizo, cerrando el círculo del reporte; y la llegada de una nota nueva se anuncia al instante con una **notificación en tiempo real** (Socket.IO) al equipo de la obra. La trazabilidad es navegable en ambos sentidos: desde una tarea se accede a las **notas de voz que la originaron o modificaron**, con el audio reproducible y la cita que lo justifica. El historial de notas se explora con **búsqueda y filtros** (por texto o responsable, por tipo de acción y por fecha).
- **Módulo de presupuestos con IA:** acepta presupuestos de proveedores en múltiples formatos (PDF, imagen, Excel o texto) y, con el mismo modelo de lenguaje, extrae sus datos a una estructura validada (proveedor, fecha, rubro, moneda, ítems con cantidad/unidad/precio/subtotal, IVA, total, flete, plazo de entrega, condiciones de pago y validez). Detecta **inconsistencias** (por ejemplo, totales que no cierran o faltantes de precios) con su severidad, y **compara** varios presupuestos calculando el promedio, el más económico y el desvío porcentual de cada uno.
- **Módulo de planos:** repositorio de documentación con **versionado** por obra y disciplina; marca la última versión vigente y permite su consulta y envío por WhatsApp, evitando que en el campo se trabaje sobre planos desactualizados.
- **Módulo de materiales, presupuesto y compras:** cómputo de materiales por tarea (con unidad, precio unitario y estado de aprovisionamiento), presupuesto por obra (estimado frente a real) y un flujo de **solicitudes de cotización**: desde la obra se seleccionan los materiales pendientes y los proveedores a consultar; el sistema genera un PDF de solicitud y lo envía a cada proveedor por WhatsApp. Cuando el proveedor responde con su presupuesto en PDF —también por WhatsApp—, el sistema lo detecta, lo descarga y delega en el módulo de presupuestos la extracción estructurada con IA. Con dos o más respuestas, se dispara automáticamente un **análisis comparativo** (Claude con salida estructurada JSON Schema) que compara los presupuestos ítem por ítem, identifica ventajas y riesgos de cada proveedor y emite una recomendación fundamentada. Al confirmar el proveedor elegido, se genera la **orden de compra** y los materiales pasan al estado "pedido".

### Pruebas

La estrategia de verificación combinó distintos niveles:

- **Plan de pruebas:** se mantiene un conjunto de casos de prueba manuales documentados en `docs/casos_de_prueba.md`.
- **Pruebas funcionales y de aceptación:** cada módulo se verificó ejecutando la aplicación en el navegador contra el backend real, comprobando el comportamiento esperado de las interacciones (por ejemplo, el relleno por arrastre con encadenado de fechas persistiendo en la base, o el flujo completo de la bitácora por voz).
- **Pruebas de integración:** se verificaron de extremo a extremo los flujos que atraviesan varias capas e integraciones, como el envío de una nota de voz por WhatsApp → transcripción → análisis con IA → registro en la bitácora, y la lectura y comparación de presupuestos con el modelo de lenguaje.
- **Verificación de regresiones:** ante cada cambio se ejecutó la verificación de tipos (`tsc`) y la compilación de producción del frontend, y se realizó una auditoría general de la aplicación documentada en `docs/auditoria-general.md`.

A modo ilustrativo, se presentan algunos casos de prueba representativos (el conjunto completo se detalla en `docs/casos_de_prueba.md`):

| Caso | Acción | Resultado esperado |
|---|---|---|
| Carga masiva con encadenado de fechas | Arrastrar el controlador de relleno sobre una columna de fechas en la planilla | Las fechas se encadenan según la duración y persisten en la base. |
| Reprogramación en cascada | Mover una tarea con tareas sucesoras en el Gantt | El sistema muestra la vista previa de las tareas afectadas y, al confirmar, registra un único evento. |
| Ajuste a día laboral | Crear o mover una tarea con fecha en fin de semana o feriado | La fecha se corre al día laboral más cercano con un aviso, sin bloquear la operación. |
| Bitácora por voz | Enviar una nota de voz de obra por WhatsApp | Se transcribe, se genera el resumen y las sugerencias, y la entrada queda asociada a la obra. |
| Nota de voz sin obra | Enviar una nota desde un emisor con varias obras y no responder cuál | El sistema recuerda cada 30 min asignar obra (hasta 48 h) y, si no se responde, la nota queda visible para asignación manual del jefe. |
| Comparación de presupuestos | Cargar dos o más presupuestos de proveedores | Se extraen los datos, se marcan inconsistencias y se indica el más económico con su desvío. |
| Límite de plan | Crear una obra por encima del límite del plan | La API responde HTTP 402 y el frontend ofrece la mejora de plan. |
| Aislamiento multi-inquilino | Consultar datos con un usuario de otra empresa | No se exponen obras ni datos ajenos al *tenant*. |
| Solicitud de cotización | Crear una solicitud, simular respuestas PDF de dos proveedores por WhatsApp y confirmar el proveedor recomendado | La IA extrae los datos de cada PDF, genera el análisis comparativo y la orden de compra queda asociada a la solicitud. |

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

A modo de referencia verificada durante las pruebas, el costo de procesar una nota de voz de obra —que comprende dos llamadas a modelos de IA: la transcripción del audio y su posterior análisis con salida estructurada— se ubicó en el orden de **un centavo de dólar por audio de dos minutos**. Esto indica que el costo variable de IA por uso es marginal frente al valor que aporta, y que la elección de modelos de bajo costo por operación (un modelo de reconocimiento del habla económico y un modelo de lenguaje de la familia Haiku) es determinante para la sustentabilidad del modelo de negocio.

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

El proyecto CONSTRUCTA permitió construir una plataforma funcional que aborda la desconexión entre la planificación y la ejecución en obra. Se cumplieron los objetivos específicos planteados: la gestión integral de obras y tareas, la visualización del cronograma con ruta crítica y línea base, la carga de baja fricción, el asistente de WhatsApp con identificación de emisores, la bitácora de obra asistida por IA, la gestión de presupuestos con lectura y comparación automática, el flujo de solicitudes de cotización a proveedores con análisis comparativo asistido por IA, el repositorio de planos consultable por WhatsApp, el sistema de alertas y el aislamiento multi-inquilino con planes.

Entre los principales aprendizajes del desarrollo se destacan: la importancia de **minimizar la fricción de adopción** como criterio de diseño rector; el valor de los modelos de lenguaje con **salida estructurada** para convertir lenguaje natural (mensajes y notas de voz) en datos accionables de forma confiable; y la necesidad de **verificar en condiciones reales** —ejecutando la aplicación y los flujos de integración— para detectar problemas que las verificaciones de compilación no revelan.

Como objetivos no cumplidos o pendientes se identifican: la notificación automática al jefe o administrador de obra cuando un responsable responde a un recordatorio (funcionalidad analizada y diseñada, no implementada), la pasarela de pago para el cobro efectivo de los planes, y la incorporación de pruebas unitarias automatizadas con métrica de cobertura.

> **[COMPLETAR]** Agregar reflexiones personales del equipo sobre el proceso, si corresponde.

---

## Bibliografía / Referencias

> Listado en formato APA v7. Se priorizan fuentes verificables (documentación oficial y bibliografía técnica). **[COMPLETAR]** con las fuentes académicas del dominio que se hayan utilizado y con los datos de acceso (fecha de consulta) según exija la cátedra. Recordá usar la herramienta de Citas de Google Docs (Tools → Citations) y citar en el texto cada fuente que aparezca aquí.

- Alembic. (2026). *Alembic documentation*. https://alembic.sqlalchemy.org
- Anthropic. (2026). *Claude API documentation*. Anthropic. https://docs.anthropic.com
- FastAPI. (2026). *FastAPI documentation*. https://fastapi.tiangolo.com
- Kelley, J. E., & Walker, M. R. (1959). Critical-path planning and scheduling. *Proceedings of the Eastern Joint Computer Conference*, 160–173.
- Meta Platforms. (2026). *WhatsApp Business Platform documentation*. https://developers.facebook.com/docs/whatsapp
- OpenAI. (2026). *Speech-to-text (audio transcription) documentation*. https://platform.openai.com/docs/guides/speech-to-text
- PostgreSQL Global Development Group. (2026). *PostgreSQL documentation*. https://www.postgresql.org/docs/
- Project Management Institute. (2021). *A guide to the project management body of knowledge (PMBOK guide)* (7th ed.). PMI.
- React. (2026). *React documentation*. Meta. https://react.dev
- Socket.IO. (2026). *Socket.IO documentation*. https://socket.io/docs/
- SQLAlchemy. (2026). *SQLAlchemy 2.0 documentation*. https://docs.sqlalchemy.org
- Twilio. (2026). *Twilio API for WhatsApp documentation*. https://www.twilio.com/docs/whatsapp
- TypeScript. (2026). *TypeScript documentation*. Microsoft. https://www.typescriptlang.org/docs/

---

## Anexos

Información suplementaria, no necesaria para el entendimiento mínimo del proyecto:

- **Anexo A — Bitácora de desarrollo completa:** `docs/documentacion.md` (registro cronológico de avances, decisiones y validaciones).
- **Anexo B — Esquema de base de datos:** `docs/database.md` (detalle de tablas, columnas y relaciones).
- **Anexo C — Casos de prueba manuales:** `docs/casos_de_prueba.md`.
- **Anexo D — Auditorías de la aplicación:** `docs/auditoria-general.md`, `docs/auditoria-ux.md`, `docs/auditoria-flujo-alta.md`.
- **Anexo E — Repositorio de código:** «URL del repositorio».
