# Informe de Proyecto Integrador — CONSTRUCTA

> **Cómo usar este documento.** El contenido sigue la estructura de la *Plantilla IPI v2.1 – 2026* (UCC, Facultad de Ingeniería) y está redactado en tono formal e impersonal (3.ª persona), listo para trasladar al Google Doc oficial. Los textos entre `«…»` y los bloques marcados **[COMPLETAR]** o **[PENDIENTE]** requieren datos o evidencia todavía no disponibles. Al maquetarlo, los párrafos normales deben quedar justificados y cada figura debe ser mencionada previamente, numerada, descrita, acompañada por su fuente y configurada con texto alternativo en Google Docs. El Resumen y el Abstract no deben exceder las 300 palabras cada uno. Las citas y referencias deben ajustarse a APA 7 y verificarse con la herramienta de Citas de Google Docs.

---

## Portada

**Universidad Católica de Córdoba**
**Facultad de Ingeniería**

**Proyecto: CONSTRUCTA — Plataforma de gestión de obras de construcción con asistente de WhatsApp e inteligencia artificial**

Informe de Proyecto Integrador

**Alumnos:**
- Becerra, Martina
- Graffigna, Facundo
- Llancaman, Agustín

**Directores:**
- Carreño, Ignacio Luciano
- Porrini, Federico Eduardo
- Juarez, Leandro

13 de agosto de 2026
Córdoba — Argentina

---

## Resumen

La industria de la construcción gestiona la comunicación de obra de manera predominantemente informal —mensajes de WhatsApp, llamadas telefónicas y notas de papel—, lo que provoca que el avance real del trabajo en el campo no quede registrado ni vinculado al plan de obra.

Esta desconexión entre el plan y el campo genera retrabajo, demoras detectadas tarde y pérdida de trazabilidad: el responsable de cada tarea conoce el estado real, pero esa información no llega de forma estructurada a quien planifica. Las herramientas existentes (software de planificación tradicional) exigen que cada participante adopte una aplicación nueva, barrera que en obra rara vez se supera.

Se desarrolló CONSTRUCTA, una aplicación web de gestión de obras que conecta el cronograma con el campo a través de un asistente de WhatsApp: los responsables reportan el estado de sus tareas y registran notas de voz desde el número que ya usan, sin instalar ninguna aplicación. El sistema combina un backend de servicios (FastAPI, PostgreSQL, comunicación en tiempo real mediante Socket.IO) con un frontend de página única (React) e integra modelos de inteligencia artificial para transcribir y estructurar las notas de obra y para interpretar presupuestos de proveedores.

La solución implementada cubre el ciclo de gestión: planificación con Gantt y ruta crítica, carga masiva de tareas, alertas automáticas, bitácora de obra por voz asistida por IA, gestión documental de presupuestos con lectura automática, y un repositorio de planos consultable por WhatsApp.

Como conclusión, CONSTRUCTA demuestra que es viable reducir la fricción de adopción en obra manteniendo el canal de comunicación que los equipos ya utilizan, y que la incorporación de IA sobre ese canal convierte mensajes informales en información estructurada y accionable sobre el plan de obra.

**Palabras clave:** gestión de obras, comunicación de obra, WhatsApp, inteligencia artificial, planificación, ruta crítica.

## Abstract

The construction industry manages on-site communication mostly informally —WhatsApp messages, phone calls and paper notes—, which means that the real progress of field work is neither recorded nor linked to the work plan.

This disconnection between plan and field causes rework, delays detected too late and loss of traceability: the person responsible for each task knows the real status, but that information never reaches the planner in a structured way. Existing tools (traditional planning software) require every participant to adopt a new application, a barrier rarely overcome on a construction site.

CONSTRUCTA was developed, a web application for construction management that connects the schedule with the field through a WhatsApp assistant: task owners report task status and record voice notes from the number they already use, without installing any app. The solution combines a service backend (FastAPI, PostgreSQL, real-time communication via Socket.IO) with a single-page frontend (React) and integrates artificial-intelligence models to transcribe and structure field notes and to interpret supplier quotes.

The implemented solution covers the management cycle: Gantt-based planning with critical path, bulk task entry, automatic alerts, AI-assisted voice work log, document management of supplier quotes with automatic reading, and a blueprint repository queryable via WhatsApp.

In conclusion, CONSTRUCTA shows that it is feasible to reduce on-site adoption friction by keeping the communication channel teams already use, and that adding AI on top of that channel turns informal messages into structured, actionable information about the work plan.

**Keywords:** construction management, on-site communication, WhatsApp, artificial intelligence, planning, critical path.

---

## Presentación del tema

El presente proyecto integrador aborda la gestión de la información en obras de construcción, con foco en el vínculo entre la planificación y la ejecución en el campo. En el sector, la planificación suele realizarse en herramientas de escritorio (planillas de cálculo o software de planificación), mientras que la comunicación diaria de obra ocurre por canales informales como la mensajería instantánea. Esta separación entre dónde se planifica y dónde se comunica el avance constituye el eje del proyecto.

El propósito de CONSTRUCTA es **conectar el plan de obra con el campo sin obligar a los participantes a cambiar su forma de comunicarse**. La propuesta de valor que guía el diseño se resume en que el equipo conserva los conceptos de planificación que ya conoce —cronogramas tipo Gantt, planillas, dependencias entre tareas— mientras la plataforma se encarga de capturar, estructurar y registrar lo que ocurre en la obra a través del canal que los responsables ya utilizan a diario.

El tema es relevante porque la construcción es una actividad económica intensiva en coordinación, donde una demora o un dato no comunicado a tiempo se propaga al resto del cronograma y se traduce en costos. Reducir la fricción de adopción de una herramienta de gestión —principal motivo por el que muchas soluciones fracasan en obra— constituye, en sí mismo, una oportunidad de mejora con impacto potencial en la productividad del sector, en la medida en que contribuya a reducir esperas, retrabajos y demoras evitables.

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

**Delimitación del problema.** La industria de la construcción se organiza mediante proyectos temporales en los que intervienen profesionales, contratistas, subcontratistas, proveedores y comitentes con prácticas, recursos y objetivos diferentes. Esta configuración favorece la fragmentación de la información y dificulta su circulación entre quienes planifican, coordinan y ejecutan las tareas en el sitio (Adriaanse et al., 2010).

La gestión de la información de campo constituye un componente operativo del proyecto: el estado de las actividades, las decisiones, las modificaciones, los planos y las restricciones deben llegar a las personas responsables en forma oportuna y comprensible. Cho et al. (2023) comprobaron, en un estudio sobre reportes diarios de obra mediante mensajería móvil, que las barreras de comunicación pueden persistir aun cuando ya se utiliza mensajería instantánea (WhatsApp, KakaoTalk): las conversaciones resultan "ruidosas" y sin un inicio o fin de reporte claramente identificable, lo que dificulta estructurar la información producida en obra. Xu y Luo (2014), a partir de la observación directa de dos obras, relacionaron las pérdidas de tiempo con tres problemas de información: inconsistencia, deslocalización —la información no llega a la persona adecuada en el momento requerido— y ambigüedad. Por tratarse de estudios realizados fuera de la Argentina y sobre casos específicos, sus resultados no se extrapolan estadísticamente al segmento objetivo, pero permiten explicar los mecanismos por los cuales una circulación deficiente de la información puede producir esperas, negociaciones, retrabajos y demoras.

El problema se desarrolla, además, dentro de un sector con desafíos estructurales de productividad. Mischke et al. (2024), en una actualización del McKinsey Global Institute, estimaron que entre 2000 y 2022 la productividad de la construcción global mejoró apenas un 10 % (0,4 % anual), frente a un 50 % (2 % anual) de la economía en general y a un 90 % (3 % anual) de la industria manufacturera. El rezago es multifactorial y no puede atribuirse únicamente a la comunicación; el informe incluye, entre otros factores, la fragmentación, las deficiencias de gestión y la baja adopción de herramientas digitales. En el contexto argentino, una encuesta de la Cámara Argentina de la Construcción a 90 empresas de entre 15 y 150 empleados señaló la falta de registros y la escasez de mecanismos sistemáticos para obtener y analizar datos de gestión de obra (Cámara Argentina de la Construcción, 2018).

El relevamiento cualitativo realizado por el equipo aportó evidencia local en la misma dirección. Durante junio de 2026 se mantuvieron encuentros exploratorios con seis informantes vinculados con obras en Córdoba: cuatro arquitectas docentes de la Universidad Católica de Córdoba con actividad profesional y estudios propios, el director de la empresa constructora RODE y un jefe de obra de esa organización. En el flujo presentado por el jefe de obra coexisten Microsoft Project para la planificación, Microsoft Excel para distintos registros y un sistema independiente para pedidos, órdenes de compra y materiales. Este caso no representa por sí solo al conjunto del sector, pero permite observar de manera concreta la fragmentación entre herramientas dentro de una operación real.

**Problema central y validación exploratoria.** A partir de la bibliografía y del relevamiento propio, el proyecto define como problema la discontinuidad entre: (1) la planificación formal, registrada en cronogramas, planillas o aplicaciones de gestión; y (2) la información producida durante la ejecución, que circula mediante conversaciones, llamadas, mensajes y archivos distribuidos. El problema central no sería, por lo tanto, la inexistencia de herramientas de planificación, sino la falta de un flujo continuo y trazable entre el dato generado en obra y el registro utilizado para controlar el proyecto. Esta discontinuidad expone a los interesados a los siguientes riesgos:

| Riesgo | Consecuencia posible |
|---|---|
| Pérdida de contexto y trazabilidad | Una decisión no queda vinculada con la obra, la tarea, el responsable y el momento en que se tomó. |
| Actualización tardía del cronograma | Los desvíos pueden detectarse después de afectar actividades dependientes. |
| Duplicación de carga | La información recibida por un canal debe transcribirse manualmente a otro sistema. |
| Información incompleta o ambigua | Aumenta la necesidad de aclaraciones y la probabilidad de registrar datos incorrectos. |
| Documentación distribuida | Puede consultarse una versión desactualizada de un plano, presupuesto u otro archivo. |
| Dependencia de conocimiento individual | El estado real de la obra queda sujeto a la memoria o disponibilidad de una persona. |

**Factores causales.** La incorporación de tecnología no garantiza por sí sola la resolución del problema. Adriaanse et al. (2010) identificaron cuatro grupos de factores que condicionan el uso efectivo de tecnologías de información y comunicación en proyectos de construcción: motivación personal, motivación externa, conocimientos y habilidades, y oportunidades reales de uso dentro del trabajo. En pequeñas y medianas empresas constructoras, la adopción también depende de las características organizacionales, la orientación estratégica y el valor percibido de la tecnología (Lu et al., 2019). Estos antecedentes fundamentan que la facilidad de aprendizaje, el esfuerzo de carga y la compatibilidad con las prácticas existentes deben considerarse requisitos de diseño, no efectos automáticos de una aplicación.

**Oportunidad y población destinataria.** La oportunidad consiste en investigar un mecanismo que reduzca el esfuerzo adicional exigido al personal de campo, capture información en el momento en que se produce y la vincule con entidades verificables del proyecto. Los encuentros reforzaron un criterio de diseño: introducir automatización sin exigir el reemplazo inmediato de herramientas y patrones ya incorporados a la rutina. El uso de un canal de mensajería conocido podría disminuir una parte de la barrera inicial, pero no se considera una interacción "sin fricción": requiere confirmación humana, control de errores, autorización, privacidad y trazabilidad. El alcance inicial se concentra en dos perfiles: el profesional independiente que supervisa directamente una o más obras y la empresa constructora con roles diferenciados de dirección, administración y ejecución. Estos perfiles delimitan el segmento a validar y no constituyen, por el momento, una caracterización estadística de todo el sector.

---

## Objetivos

### Objetivo global

Desarrollar una plataforma de gestión de obras de construcción que conecte la planificación con la ejecución en el campo, reduciendo la fricción de adopción mediante un asistente de WhatsApp que permita a los responsables reportar el avance y registrar información de obra desde el canal que ya utilizan, y que incorpore inteligencia artificial para estructurar esa información y asistir la toma de decisiones.

### Objetivos específicos

Los siguientes doce objetivos corresponden al Anteproyecto aprobado por la cátedra y constituyen la línea base respecto de la cual se evalúa el avance del proyecto en la Tabla de trazabilidad:

1. Diseñar un sistema que permita gestionar múltiples obras con sus respectivos datos generales, responsables y documentación asociada.
2. Implementar un modelo de tareas o hitos asociados a cada obra, incluyendo fechas de inicio, fechas objetivo y estados de avance.
3. Desarrollar un módulo de gestión de responsables que permita registrar y vincular actores internos y externos con las tareas.
4. Integrar un chatbot que permita enviar consultas automáticas a responsables mediante WhatsApp y registrar respuestas estructuradas sobre el estado de las tareas.
5. Implementar un sistema de estados que refleje la situación de cada tarea en función de las respuestas recibidas mediante el chatbot, con posibilidad de intervención manual en casos excepcionales.
6. Desarrollar un módulo de alertas que identifique demoras, falta de respuesta de responsables y vencimientos próximos.
7. Implementar un cronograma de obra basado en un diagrama de Gantt generado a partir de las fechas asignadas a las tareas.
8. Diseñar un panel que permita visualizar el estado general del proyecto mediante gráficos e indicadores de avance.
9. Implementar un historial que registre interacciones con el chatbot, cambios de estado de tareas y modificaciones del cronograma.
10. Desarrollar un módulo que centralice la documentación técnica de la obra y permita su consulta por parte de los responsables mediante el chatbot.
11. Desarrollar un mecanismo para cargar manualmente información relevante de la obra proveniente de interacciones o situaciones no registradas mediante el chatbot.
12. Desarrollar una bitácora de obra que reciba audios enviados por WhatsApp, los transcriba, extraiga sus puntos clave mediante un modelo de lenguaje y permita al jefe de obra revisar acciones propuestas sobre tareas, alertas o eventos.

### Tabla de trazabilidad (objetivos → evidencia)

La tabla presenta el estado técnico verificado mediante auditoría de código al **13 de agosto de 2026** (conteo directo sobre el repositorio: `find`, `grep`, `pytest --collect-only`, `alembic heads`, sin estimaciones). "Implementado" indica que existe un flujo funcional en el prototipo; no implica todavía validación con usuarios reales ni cobertura automatizada completa. Esta auditoría verifica la existencia de rutas, migraciones y pruebas recolectables por el framework; no evalúa por sí sola la corrección funcional del comportamiento ni si la funcionalidad resuelve efectivamente el problema diagnosticado — esa validación queda pendiente y se detalla como brecha explícita en la sección Pruebas.

| N.º | Objetivo | Estado al corte | Evidencia disponible | Pendiente de cierre |
|---:|---|---|---|---|
| 1 | Obras, responsables y documentación | Implementado | Alta de obra (asistente de 4 pasos), edición, listado activas/finalizadas, equipo de obra vinculado, repositorio de planos versionado. | Ampliar tipos de documentación técnica soportados más allá de planos. |
| 2 | Tareas e hitos | Implementado | Tareas con fechas, hitos, subtareas (WBS), dependencias en sus 4 tipos con desfase; estados persistidos y validados. | Ninguno relevante para el objetivo comprometido. |
| 3 | Gestión de responsables | Implementado | Directorio global de responsables, asignación a obras y tareas, equipo de obra (relación M2M con rol), edición de datos de contacto/WhatsApp. | Ninguno relevante. |
| 4 | Chatbot de WhatsApp | Implementado | *Webhook* con verificación de firma Twilio; máquina de conversación persistida (`conversation_sessions`); menú estructurado sin NLP abierto; registro automático de respuestas. | Ninguno relevante para el objetivo comprometido. |
| 5 | Sistema de estados con intervención manual | Implementado | `VALID_TRANSITIONS` (Figura 9): transiciones automáticas vía chatbot y override manual del jefe de obra desde el backoffice en casos excepcionales. | Ninguno relevante. |
| 6 | Sistema de alertas | Implementado | Servicio de evaluación de riesgos (reactivo al abrir una obra y periódico cada 4 horas para obras sin tráfico), 6 tipos de alerta con auto-resolución cuando la condición que las disparó desaparece, emisión en tiempo real por Socket.IO, traza en el historial. Auditoría dedicada en `docs/auditoria/06-alertas.md`, cerrada el 26/08/2026. | Ninguno relevante para el objetivo comprometido. |
| 7 | Cronograma (Gantt) | Implementado | Gantt interactivo con ruta crítica (CPM), línea base y reprogramación en cascada con vista previa. | Ninguno relevante. |
| 8 | Panel de indicadores | Implementado, alcance acotado | Panel de obras con indicadores numéricos (total, en progreso, planificadas, completadas) y vista resumen por obra. | Los indicadores son principalmente numéricos; podrían ampliarse a gráficos de evolución en el tiempo. |
| 9 | Historial y trazabilidad | Implementado como registro de aplicación | Tabla de historial con eventos de tareas, obras, responsables, línea base, alertas y compras, escritos por los servicios; se actualiza en tiempo real por Socket.IO. El historial de una obra eliminada se preserva (tenant_id denormalizado sobrevive a la FK) y es recuperable desde un panel administrativo. Auditoría dedicada en `docs/auditoria/07-historial.md`, cerrada el 27/08/2026. | No está reforzado a nivel de base de datos (sin triggers ni restricciones que impidan `UPDATE`/`DELETE`); es disciplina de código, no garantía de inmutabilidad. |
| 10 | Documentación técnica centralizada | Implementado, con una limitación de la plataforma | Repositorio de planos con versionado por obra y disciplina; consulta y envío de la última versión vigente por WhatsApp; control de acceso por responsable y por disciplina. Auditoría dedicada en `docs/auditoria/05-planos.md`, cerrada el 21/08/2026, con una segunda ronda de correcciones surgidas de la prueba en producción (28/08/2026). | WhatsApp no admite adjuntos de más de 16 MB: un plano que supere ese tamaño se advierte en la interfaz al cargarlo, pero quien lo solicite desde el campo no lo recibe. La compresión automática quedó fuera de alcance. |
| 11 | Carga manual de información | Implementado, absorbido en otros módulos | Planilla de tareas de edición manual tipo hoja de cálculo; edición manual de sugerencias de la bitácora antes de aplicarlas. | Ninguno relevante. |
| 12 | Bitácora de obra con IA | Implementado, con una brecha de navegación | Cadena audio → transcripción (`gpt-4o-mini-transcribe`) → análisis (Claude Haiku 4.5, salida estructurada) → resumen, puntos clave y sugerencias aplicables. Navegación tarea → notas completa. Auditoría dedicada en `docs/auditoria/08-bitacora.md` (aislamiento cross-tenant, cuota de IA por WhatsApp, límite de notas por hora, actualización en tiempo real, paginación), cerrada el 27/08/2026. | Falta la navegación inversa (nota → tarea): las sugerencias muestran el nombre de la tarea como texto plano, sin *click-through* al detalle. |

Como respaldo transversal a varios de estos objetivos, la suite automatizada del backend alcanza 72 tests distribuidos en 16 archivos (ejecutados en integración continua), que cubren aislamiento por tenant, autenticación, rate limiting e importaciones; no existen todavía pruebas automatizadas de frontend ni de extremo a extremo (véase Pruebas).

---

## Marco teórico

### 1. Contexto general del problema

El problema estudiado puede analizarse a partir de cuatro conceptos relacionados: planificación temporal, flujo de información, fragmentación interorganizacional y adopción tecnológica.

**Planificación temporal.** La gestión de proyectos de construcción se apoya en redes de actividades que representan el orden previsto de ejecución. El **método de la ruta crítica (CPM)** permite identificar, dentro de un conjunto de tareas dependientes, la secuencia cuya demora puede modificar la fecha final del proyecto (Kelley & Walker, 1959). Para ello se calculan las fechas tempranas y tardías de inicio y finalización y, a partir de estas, la **holgura** de cada actividad. La representación mediante un **diagrama de Gantt** facilita la lectura de duraciones, solapamientos e hitos sobre una línea de tiempo.

La **estructura de descomposición del trabajo (WBS)** organiza el alcance en componentes jerárquicos; las relaciones Fin–Inicio (FS), Inicio–Inicio (SS), Fin–Fin (FF) e Inicio–Fin (SF), con sus posibles desfases, expresan restricciones temporales; y la **línea base** conserva el cronograma aprobado para compararlo con la ejecución (Project Management Institute, 2021). Sin embargo, estos instrumentos solo conservan capacidad de control si reciben información actualizada y confiable desde el lugar donde se realiza el trabajo.

**Flujo y calidad de la información.** Una obra genera información en múltiples formatos: planos, documentos, fotografías, registros, conversaciones y observaciones directas. El flujo se completa cuando esa información es generada, comunicada, comprendida, registrada y utilizada para decidir. Las categorías propuestas por Xu y Luo (2014) —inconsistencia, deslocalización y ambigüedad— permiten analizar la separación entre el reporte de campo y el cronograma como un problema de continuidad y calidad de la información, y no solamente como una ausencia de software.

**Fragmentación interorganizacional.** Las organizaciones que participan de una obra son temporales, poseen responsabilidades e intereses diferentes y emplean procedimientos heterogéneos. Por esta razón, la disponibilidad de una plataforma no implica necesariamente una práctica colaborativa efectiva (Adriaanse et al., 2010). Cho et al. (2023) añaden que una herramienta destinada al sitio debe integrarse con el canal de comunicación habitual y reducir la carga impuesta al usuario; de lo contrario, puede introducir una barrera adicional en lugar de resolverla.

**Adopción tecnológica.** La adopción debe entenderse como un fenómeno sociotécnico: no depende únicamente de las funciones disponibles, sino también de la motivación, las habilidades, el apoyo organizacional, el valor percibido y las oportunidades concretas de uso. En pequeñas y medianas constructoras, estas variables pueden favorecer implementaciones graduales y beneficios operativos visibles (Lu et al., 2019).

A partir de estos antecedentes, una alternativa orientada a conectar planificación y ejecución debe evaluarse al menos según cinco criterios: **oportunidad de la información, trazabilidad, esfuerzo de uso, integración con los procesos existentes y control humano**. Estos criterios se utilizan más adelante para analizar la propuesta, sin presuponer que una tecnología específica resuelve por sí sola el problema.

### 2. Análisis de campo

#### Enfoque y participantes

Como instancia cualitativa exploratoria, durante **junio de 2026** el equipo mantuvo encuentros con **seis informantes clave** vinculados con la dirección, la planificación y la ejecución de obras en Córdoba: cuatro arquitectas docentes de la carrera de Arquitectura de la Universidad Católica de Córdoba que, además de su actividad académica, ejercen profesionalmente y dirigen sus propios estudios; el director de RODE, empresa constructora de Córdoba; y un jefe de obra de esa organización.

Los encuentros con las arquitectas y con el director de RODE se realizaron presencialmente y tuvieron una duración aproximada de entre una y dos horas. Las conversaciones con las docentes aportaron perspectivas provenientes del ejercicio profesional independiente y de estudios de arquitectura. El encuentro con el director permitió realizar una validación cualitativa inicial de la pertinencia de la idea y ampliar la comprensión del horizonte funcional esperado.

Posteriormente, el encuentro con el jefe de obra se realizó mediante Google Meet. La función de pantalla compartida permitió que mostrara su dinámica cotidiana, la relación entre sus herramientas y las aplicaciones utilizadas por la empresa. Esta instancia puede caracterizarse como una demostración guiada del flujo de trabajo y no como una observación directa de la actividad en obra; su duración no quedó registrada.

El relevamiento constituye una exploración del dominio; no equivale a una validación estadística ni demuestra todavía la adecuación del producto al mercado. RODE se identifica por su nombre como organización participante del relevamiento, no como cliente de CONSTRUCTA.

#### Hallazgos e implicancias para el diseño

| Evidencia obtenida | Alcance de la evidencia | Implicancia derivada por el equipo |
|---|---|---|
| En el flujo del jefe de obra de RODE coexisten Microsoft Project, Excel y un sistema independiente para pedidos, órdenes de compra y materiales. | Corresponde a una empresa y a un flujo particular; no permite generalizar al sector. | Resulta pertinente conservar convenciones conocidas de planificación (Gantt, dependencias) y, al mismo tiempo, unificar el flujo de compras hoy fragmentado en tres sistemas. |
| El director de RODE consideró pertinente el problema abordado y validó la necesidad de un puente entre planificación y campo. | Constituye una validación cualitativa inicial por parte de un directivo, no una decisión de compra ni una evaluación de uso. | El alcance debe contemplar tanto la visión de dirección (indicadores, control) como la operativa (reporte simple desde el campo). |
| Las arquitectas docentes confirmaron que la desconexión entre planificación y comunicación de campo es un problema real y reconocido en el ejercicio profesional independiente. | Proviene de un perfil de usuario distinto (profesional independiente) al de la empresa constructora. | La solución debe servir tanto a un estudio unipersonal como a una estructura jerárquica de obra, sin asumir un único perfil de usuario. |
| El jefe de obra mostró, en la demostración guiada, que la gestión de presupuestos de proveedores hoy requiere alternar entre varias herramientas no integradas. | Observación puntual de un flujo, no una medición de tiempo perdido ni una encuesta. | Justificó incorporar la gestión de presupuestos con IA como ampliación de alcance (ver Evolución del alcance). |

A partir de estos hallazgos, el equipo adoptó como **hipótesis de diseño** que la innovación será más viable si complementa prácticas existentes en lugar de exigir su reemplazo inmediato. Por ello, se procura mantener patrones familiares —como planillas, cronogramas tipo Gantt y canales conversacionales— e incorporar sobre ellos funciones de automatización, integración y trazabilidad. Esta decisión no implica reproducir sin evaluación las herramientas actuales, sino reducir el costo de aprendizaje y facilitar una transición progresiva hacia procesos más integrados.

#### Limitaciones y evidencia pendiente

La muestra fue intencional y reducida, estuvo vinculada con una misma red académica y profesional local, y no permite generalizar los resultados al conjunto del sector. Los encuentros no fueron grabados y no se conservaron actas, notas de campo, un cuestionario ni una guía de preguntas. Por ello, los hallazgos expuestos corresponden a una reconstrucción retrospectiva del equipo y no deben presentarse como citas textuales ni atribuirse con mayor precisión que la disponible. Tampoco se cuenta todavía con mediciones cuantitativas, pruebas formales de usabilidad ni seguimiento longitudinal. Además, ninguno de los seis informantes corresponde al perfil que operará directamente el canal conversacional en el día a día —el operario o encargado de cuadrilla que reporta el estado de una tarea—; los encuentros se realizaron con roles de dirección, docencia o supervisión de obra, por lo que la validación del mecanismo de reporte con su usuario final directo continúa pendiente. La evidencia podrá fortalecerse enviando la síntesis general a los participantes para su validación, y registrando futuras instancias mediante una guía breve (fecha, asistentes, notas y decisiones derivadas).

### 3. Opciones similares en el mercado

El relevamiento documental se concentró en alternativas que representan enfoques diferentes del problema. Microsoft Project de escritorio (Microsoft Support, s. f.) y Microsoft Planner Premium (Microsoft, s. f.) se consideran por separado: el primero apareció en el relevamiento de RODE y constituye un referente directo de planificación profesional; el segundo representa la oferta colaborativa de planificación en la nube. La comparación se limita a las capacidades publicadas por cada proveedor y a la forma de uso observada; no constituye todavía una evaluación de usabilidad, costos totales ni desempeño en empresas argentinas.

| Alternativa | Capacidades verificadas | Brecha o diferencia respecto del alcance estudiado |
|---|---|---|
| Planillas y mensajería utilizadas por separado | Baja barrera inicial, flexibilidad y herramientas ya conocidas por el equipo de obra. | La relación entre un mensaje, una tarea y una actualización del plan no queda estructurada ni es consultable después del hecho. |
| Microsoft Project de escritorio | Diagrama de Gantt, tareas y subtareas, dependencias con adelantos/atrasos, ruta crítica y línea base. | Es un referente maduro y, en el caso RODE, una herramienta ya en uso; pero está orientado al escritorio y desconectado de la comunicación de campo. |
| Microsoft Planner Premium | Dependencias FS, SS, FF y SF, actualización de fechas, vista de Gantt, ruta crítica, hitos y jerarquía de tareas (Microsoft, s. f.). | Es una alternativa sólida de planificación general. La documentación consultada no describe captura de avances de obra mediante mensajes o audios de WhatsApp. |
| Procore | Plataforma integral de gestión de construcción (preconstrucción a cierre); captura de campo robusta (partes diarios, RFIs, submittals, punch list, inspecciones) vía app móvil con soporte offline; cronograma histórico de solo lectura importado desde MS Project o Primavera P6, con un motor Gantt nativo editable recién en beta abierta durante 2026 (Procore Technologies, s. f.). | La documentación oficial menciona "WhatsApp" únicamente como acceso directo desde la agenda de contactos, que abre la app nativa de WhatsApp con el número precargado — sin flujo de datos de regreso a la plataforma, registro estructurado ni chatbot. |
| Autodesk Construction Cloud (rebrandeado a Autodesk Forma en 2026) | Suite orientada a gestión documental y coordinación de modelos BIM, con captura de campo robusta (RFIs, submittals, reportes diarios, checklists) vía app móvil nativa con soporte offline; el módulo de cronograma importa y visualiza archivos de Primavera P6, MS Project o Asta Powerproject, sin edición nativa de tareas o dependencias documentada (Autodesk, s. f.). | La documentación oficial consultada no describe ningún mecanismo de reporte de campo por WhatsApp, SMS o canal conversacional; las notificaciones del sistema se documentan exclusivamente por email y por notificaciones push dentro de la app. |
| Herramientas genéricas de tareas (Trello, Asana) | Flexibles, de bajo costo y de adopción simple. | Carecen de las capacidades propias de planificación de obra (ruta crítica, línea base, cómputo). |

El análisis evita dividir el mercado entre "planificadores sin campo" y "herramientas de campo sin estructura", porque Procore y Autodesk ya conectan ambos entornos (Procore Technologies, s. f.; Autodesk, s. f.). Microsoft Project representa una referencia especialmente relevante por la profundidad de su planificación y por su presencia en el caso relevado. Ninguna de las alternativas relevadas ofrece captura estructurada de avances de obra mediante un canal conversacional ya adoptado por el usuario: las que mencionan la aplicación de mensajería lo hacen únicamente como acceso directo a la app externa, sin integración de datos con la plataforma. La carencia común a estas alternativas es la falta de un puente de baja fricción entre el plan y el campo. La relación concreta entre estas alternativas y la propuesta desarrollada se analiza en la sección siguiente.

### 4. Tecnologías investigadas

Para la construcción de la solución se evaluaron y seleccionaron las siguientes tecnologías:

- **Backend — API de servicios:** se adoptó FastAPI (framework web de Python; FastAPI, 2026) por su soporte nativo de asincronismo y su validación de datos por tipos, frente a alternativas síncronas. La persistencia se resolvió con SQLAlchemy 2.0 (SQLAlchemy, 2026) en modo asíncrono sobre PostgreSQL (PostgreSQL Global Development Group, 2026), motor relacional robusto y de licencia abierta.
- **Tiempo real:** se incorporó Socket.IO (Socket.IO, 2026) para la comunicación bidireccional (presencia de usuarios, alertas y edición colaborativa), frente a un esquema de sondeo periódico que habría sido menos eficiente.
- **Frontend — aplicación de página única:** se utilizó React (React, 2026) con TypeScript (TypeScript, 2026) y Vite, por su madurez, su tipado estático y la velocidad de su entorno de desarrollo.
- **Mensajería:** se integró la API de WhatsApp (Meta Platforms, 2026) a través de Twilio (Twilio, 2026), por ser un proveedor consolidado con soporte de mensajes y de envío de archivos multimedia.
- **Inteligencia artificial — modelos de lenguaje:** se evaluó el uso de modelos de lenguaje de gran escala (LLM) para dos tareas distintas —estructuración de texto y comprensión de documentos—, seleccionando el modelo Claude Haiku 4.5 (Anthropic, 2026) por su soporte de *structured outputs* (salida forzada a un esquema JSON, lo que garantiza que la respuesta del modelo sea procesable por el sistema sin análisis frágil de texto libre) y de lectura nativa de documentos PDF e imágenes. La técnica de salida estructurada es central para la confiabilidad de la solución: convierte lenguaje natural —mensajes y notas de voz— en datos validados contra un esquema, en lugar de texto a interpretar manualmente.
- **Inteligencia artificial — reconocimiento del habla:** para la transcripción de voz a texto se incorporó un modelo de reconocimiento automático del habla (ASR) orientado al español rioplatense (`gpt-4o-mini-transcribe`; OpenAI, 2026), de bajo costo por minuto, que constituye el primer eslabón del procesamiento de las notas de voz de obra.
- **Comunicación en tiempo real y orientada a eventos:** la solución combina dos mecanismos asíncronos. Por un lado, un *webhook* HTTP recibe los mensajes entrantes de WhatsApp (arquitectura orientada a eventos: el proveedor de mensajería notifica al sistema). Por el otro, *websockets* (Socket.IO) empujan al navegador, sin sondeo, los cambios de estado (presencia, alertas y edición colaborativa).
- **Correo transaccional:** se integró un proveedor de correo (Brevo) para las invitaciones de equipo.
- **Privacidad y tratamiento de datos con proveedores de IA:** el envío de audios, notas y documentos de obra a servicios externos (Anthropic, OpenAI) implica transferir información potencialmente sensible o contractual fuera de la infraestructura propia. A la fecha no se han definido políticas formales de retención, eliminación ni acuerdos de tratamiento de datos con estos proveedores; este punto queda pendiente de definición antes de un despliegue con datos reales de clientes.

---

## Propuesta de solución

La propuesta de solución consiste en una plataforma web —CONSTRUCTA— compuesta por un backend de servicios, un frontend de página única y un asistente conversacional sobre WhatsApp, integrada con modelos de inteligencia artificial. A continuación se detalla el alcance funcional, el diseño, la implementación y las pruebas.

### Alcance funcional

#### Dentro de alcance

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

#### Fuera de alcance

- Integración contable o de facturación con sistemas externos.
- Aplicación móvil nativa (el acceso de campo es por WhatsApp; la aplicación web es responsiva).
- Pasarela de pago para el cobro de los planes (el sistema modela los límites del plan, pero no procesa pagos).
- Notificación al jefe/administrador ante la respuesta de un responsable a un recordatorio (funcionalidad analizada, no implementada).
- **Interpretación de lenguaje natural:** el asistente de WhatsApp para responsables de tareas opera con menús y estados predefinidos (interacciones estructuradas), no con comprensión de lenguaje libre; esta limitación se mantiene conforme a lo comprometido en el Anteproyecto. La comprensión de lenguaje natural se aplica únicamente, y de forma acotada, al procesamiento de las notas de voz de la bitácora de obra y a la lectura de presupuestos de proveedores.

#### Evolución del alcance respecto del Anteproyecto

El Anteproyecto aprobado por la cátedra excluía explícitamente la gestión de costos, presupuestos y finanzas de la obra. Durante el desarrollo y las entrevistas con los profesionales, el equipo identificó que la gestión documental de presupuestos de proveedores era una extensión natural de la bitácora de obra con IA —ambas comparten la misma capacidad de lectura estructurada de documentos con modelos de lenguaje— y decidió incorporarla como ampliación de alcance, junto con otras capacidades que surgieron durante la implementación y que no formaban parte del compromiso original:

- Planificación avanzada: estructura de descomposición del trabajo (WBS), cuatro tipos de dependencia con desfase, cálculo de ruta crítica (CPM) y línea base.
- Planilla de tareas de edición tipo hoja de cálculo, con importación desde Excel y MS Project.
- Gestión de presupuestos de proveedores con IA, solicitudes de cotización y órdenes de compra.
- Arquitectura multi-inquilino (aislamiento de datos por empresa) y esquema de planes de suscripción con límites de uso.

Estas ampliaciones no reemplazan ni contradicen los objetivos originales del Anteproyecto —el núcleo de gestión de obras, tareas, responsables, chatbot estructurado, alertas y cronograma se mantiene íntegramente— sino que se suman a partir de oportunidades de mejora detectadas durante la construcción del sistema.

#### Especificación de requerimientos funcionales (RF)

A partir de la descripción narrativa anterior, se detalla a continuación el modelado completo de requerimientos funcionales, agrupado por módulo y numerado para su trazabilidad.

**Gestión de Obras**
- **RF-01:** El sistema debe permitir crear una obra con nombre, ubicación, tipo y fechas generales.
- **RF-02:** El sistema debe permitir editar los datos de una obra existente.
- **RF-03:** El sistema debe permitir listar obras activas y finalizadas.
- **RF-04:** El sistema debe centralizar el acceso a toda la información de una obra (tareas, responsables, documentación, historial) desde una única vista.

**Gestión de Tareas**
- **RF-05:** El sistema debe permitir crear tareas o hitos asociados a una obra, con fecha de inicio y fecha objetivo.
- **RF-06:** El sistema debe permitir editar y eliminar tareas.
- **RF-07:** El sistema debe permitir visualizar todas las tareas de una obra.
- **RF-08:** Los responsables de campo no pueden modificar el estado de una tarea directamente; el sistema lo actualiza automáticamente a partir de las respuestas recibidas por el chatbot. El jefe de obra puede modificar el estado manualmente desde el backoffice en casos excepcionales.

**Gestión de Responsables**
- **RF-09:** El sistema debe permitir registrar responsables (operarios, contratistas, proveedores).
- **RF-10:** El sistema debe permitir asignar un responsable a cada tarea.
- **RF-11:** El sistema debe permitir conformar un equipo de trabajo por obra, vinculando múltiples responsables a una misma obra con un rol específico.
- **RF-12:** El sistema debe permitir editar datos de contacto de un responsable, incluyendo su número de WhatsApp.
- **RF-13:** El sistema debe permitir reasignar responsables a tareas ya existentes.

**Chatbot por WhatsApp**
- **RF-14:** El sistema debe enviar consultas automáticas a los responsables sobre el estado de sus tareas asignadas.
- **RF-15:** El chatbot debe presentar únicamente opciones de respuesta estructuradas y predefinidas, sin procesamiento de lenguaje natural abierto.
- **RF-16:** El sistema debe registrar automáticamente las respuestas recibidas y asociarlas a la tarea correspondiente.
- **RF-17:** El chatbot debe permitir al responsable informar avances, reportar demoras o problemas mediante las opciones estructuradas.
- **RF-18:** El chatbot debe permitir a los responsables consultar documentación relevante de la obra, como planos.
- **RF-19:** El chatbot debe identificar la obra y la tarea asociadas a cada interacción entrante.

**Estados y Seguimiento de Tareas**
- **RF-20:** El sistema debe actualizar automáticamente el estado de una tarea en función de la respuesta recibida por el chatbot.
- **RF-21:** El sistema debe soportar, como mínimo, los estados: Pendiente, En progreso, Bloqueada, Completada y Cancelada (`VALID_TRANSITIONS`, ver Figura 9).
- **RF-22:** El sistema debe identificar automáticamente tareas atrasadas, tareas sin respuesta y tareas en riesgo.

**Sistema de Alertas**
- **RF-23:** El sistema debe generar alertas automáticas ante demoras, falta de respuesta o vencimientos próximos de tareas.
- **RF-24:** El sistema debe notificar al jefe de obra ante situaciones críticas detectadas.

**Cronograma (Gantt)**
- **RF-25:** El sistema debe generar automáticamente un cronograma tipo Gantt a partir de las fechas de las tareas registradas.
- **RF-26:** El sistema debe permitir visualizar el avance de la obra en el tiempo sobre el Gantt.
- **RF-27:** El sistema debe detectar retrasos y su posible impacto en tareas dependientes, pudiendo reprogramarlas en cascada de forma opcional y previa confirmación del usuario.
- **RF-28:** El sistema debe permitir definir dependencias entre tareas de los tipos fin-inicio (FS), inicio-inicio (SS), fin-fin (FF) e inicio-fin (SF), con un desfase configurable en días.
- **RF-29:** El sistema debe permitir organizar tareas en una estructura jerárquica de subtareas (WBS), donde cada tarea puede tener una tarea padre asociada.

**Línea Base**
- **RF-30:** El sistema debe permitir guardar una línea base del cronograma, registrando un snapshot del estado planificado en un momento determinado.
- **RF-31:** El sistema debe permitir comparar visualmente la línea base con el estado actual del cronograma directamente sobre el Gantt.

**Ruta Crítica**
- **RF-32:** El sistema debe calcular y resaltar visualmente la ruta crítica del proyecto mediante el método CPM (*Critical Path Method*).

**Calendario Laboral**
- **RF-33:** El sistema debe permitir configurar un calendario laboral por obra, indicando días hábiles, feriados y excepciones.
- **RF-34:** El sistema debe utilizar el calendario laboral configurado para el cálculo de duraciones y fechas en el cronograma.

**Dashboard General**
- **RF-35:** El sistema debe mostrar indicadores clave: porcentaje de avance, tareas completadas, pendientes y demoradas.
- **RF-36:** El sistema debe presentar gráficos de estado general del proyecto.

**Documentación de Obra**
- **RF-37:** El sistema debe permitir subir y versionar planos y documentación técnica de la obra.
- **RF-38:** El sistema debe permitir consultar la documentación desde el backoffice y desde el chatbot.

**Import / Export**
- **RF-39:** El sistema debe permitir importar tareas desde archivos Excel o CSV, detectando automáticamente el mapeo de columnas.
- **RF-40:** El sistema debe requerir confirmación del usuario antes de aplicar una importación, mostrando una vista previa de los datos a importar.
- **RF-41:** El sistema debe permitir exportar el cronograma de una obra a formato Excel.
- **RF-42:** El sistema debe permitir exportar el presupuesto de una obra a formato Excel.

**Registro Manual de Información**
- **RF-43:** El sistema debe permitir registrar avances, incidencias o notas manuales que no provengan del chatbot.
- **RF-44:** El registro manual no debe modificar automáticamente el estado de las tareas.

**Historial y Trazabilidad**
- **RF-45:** El sistema debe registrar un historial *append-only* de cambios de estado, respuestas del chatbot, alertas generadas y acciones manuales, con fecha y origen de cada evento.

**Bitácora de Obra (módulo de IA)**
- **RF-46:** El sistema debe permitir recibir audios o notas de texto enviados por WhatsApp por el jefe de obra al finalizar una inspección.
- **RF-47:** El sistema debe transcribir automáticamente los audios recibidos mediante reconocimiento de voz.
- **RF-48:** El sistema debe procesar la transcripción con un modelo de lenguaje para extraer puntos clave, presentándolos como ítems estructurados en el backoffice.
- **RF-49:** El sistema debe permitir, desde cada ítem de la bitácora, crear una tarea, generar una alerta o registrar un evento en el historial.

**Materiales por Tarea**
- **RF-50:** El sistema debe permitir registrar materiales asociados a cada tarea, con nombre, cantidad, unidad, precio unitario y estado (pendiente, pedido, recibido).
- **RF-51:** El sistema debe mostrar una vista de presupuesto consolidada por obra con el costo estimado por tarea y el total general.

**Presupuestos con IA**
- **RF-52:** El sistema debe permitir cargar presupuestos en formato imagen o PDF y extraer sus ítems automáticamente mediante inteligencia artificial.
- **RF-53:** El sistema debe comparar presupuestos cargados e identificar inconsistencias entre ellos.

**Proveedores**
- **RF-54:** El sistema debe permitir gestionar un directorio de proveedores por organización, con nombre, categoría, email y teléfono.
- **RF-55:** El sistema debe permitir asociar un proveedor a los materiales de una tarea.

**Solicitudes de Cotización**
- **RF-56:** El sistema debe permitir generar solicitudes de cotización a uno o varios proveedores, vinculadas a los materiales de tareas.
- **RF-57:** El sistema debe registrar las respuestas de los proveedores como presupuestos comparables asociados a la obra.

**Órdenes de Compra**
- **RF-58:** El sistema debe permitir generar órdenes de compra asociadas a una obra y un proveedor.
- **RF-59:** El sistema debe permitir enviar la orden de compra al proveedor por WhatsApp o email.
- **RF-60:** El sistema debe permitir confirmar la recepción de materiales de una orden, actualizando el estado de los ítems correspondientes.

**Autenticación y Control de Acceso**
- **RF-61:** El sistema debe permitir el registro e inicio de sesión de usuarios mediante credenciales.
- **RF-62:** El sistema debe implementar control de acceso basado en roles (administrador y colaborador).
- **RF-63:** El sistema debe permitir la recuperación de contraseña mediante un enlace enviado por email.
- **RF-64:** El sistema debe verificar el email del usuario tras el registro antes de habilitar el acceso completo.
- **RF-65:** El sistema debe permitir al usuario gestionar su perfil, incluyendo nombre y contraseña.

**Gestión de Usuarios**
- **RF-66:** El sistema debe permitir al administrador invitar nuevos usuarios a la organización mediante email, asignándoles un rol predefinido.
- **RF-67:** El sistema debe permitir al administrador cambiar el rol de un usuario existente.
- **RF-68:** El sistema debe permitir al administrador eliminar usuarios de la organización.

**Multi-tenant y Planes**
- **RF-69:** El sistema debe aislar los datos y usuarios de cada organización (multi-tenant), garantizando que ninguna organización acceda a información de otra.
- **RF-70:** El sistema debe gestionar planes de suscripción con límites configurables de obras, usuarios y tareas por organización.
- **RF-71:** El sistema debe permitir al administrador consultar el uso actual del plan, mostrando la cantidad de obras, usuarios y tareas utilizadas respecto al límite contratado.

**Presencia en Tiempo Real**
- **RF-72:** El sistema debe mostrar en tiempo real qué usuarios están conectados activamente en una misma obra.

#### Requerimientos no funcionales

- **RNF-01 (Seguridad):** la API autentica las operaciones con tokens JWT, aplica permisos por rol (administrador/colaborador) y contraseñas con *hashing*; los recursos sensibles usan URLs firmadas. La auditoría del 13/08/2026 había identificado dos rutas sin filtro de tenant (presencia y simulación de vencidos administrativa); ambas quedaron corregidas en la remediación de las auditorías 06 y 11 (26/08/2026).
- **RNF-02 (Disponibilidad):** el sistema debe estar disponible para recibir y procesar mensajes de WhatsApp de forma continua durante el horario de obra.
- **RNF-03 (Usabilidad):** el personal de campo debe poder realizar los reportes principales mediante WhatsApp, y el backoffice debe conservar patrones conocidos de planilla y cronograma. La reducción efectiva del esfuerzo de aprendizaje deberá medirse mediante pruebas con usuarios.
- **RNF-04 (Escalabilidad):** la arquitectura debe soportar múltiples obras y organizaciones (multi-tenant) sin degradación significativa del rendimiento; la sesión conversacional se persiste en base de datos, pero la presencia y parte de Socket.IO mantienen estado por proceso, por lo que el escalado horizontal requerirá infraestructura compartida.
- **RNF-05 (Rendimiento):** las consultas al chatbot deben procesarse en tiempos compatibles con el uso cotidiano en obra. El backend emplea entrada/salida asíncrona y Socket.IO para la mayoría de las actualizaciones, aunque dos flujos (presencia global y estado de solicitudes de cotización) todavía usan sondeo periódico; faltan umbrales y mediciones reproducibles de tiempos de respuesta.
- **RNF-06 (Mantenibilidad):** separación en capas (router → service → repository), esquema de base de datos versionado con migraciones (Alembic) y tipado estático en backend (Python con anotaciones de tipo) y frontend (TypeScript).
- **RNF-07 (Portabilidad/Despliegue):** el sistema debe poder desplegarse en infraestructura cloud con un proceso de despliegue reproducible.
- **RNF-08 (Confiabilidad del módulo de bitácora):** ninguna sugerencia generada por el modelo de lenguaje modifica el plan sin revisión y confirmación humana; los fallos de transcripción, análisis o conectividad deben quedar visibles y permitir reintento o corrección, sin pérdida del audio original.
- **RNF-09 (Trazabilidad):** toda acción relevante del sistema (cambios de estado, alertas, interacciones) debe quedar registrada con fecha y usuario/origen. El historial actual funciona como registro de aplicación orientado a anexar eventos, pero no está reforzado por restricciones de base de datos y no constituye, por sí solo, un mecanismo de inmutabilidad o no repudio.

> **[FIGURA 1: Diagrama de casos de uso de CONSTRUCTA — actores (Administrador, Responsable, Asistente de WhatsApp) y casos de uso principales. Fuente: elaboración propia.]**

#### Relación con Microsoft Project

Por haber sido identificado en el relevamiento de RODE, Microsoft Project se considera tanto una alternativa de mercado como una referencia de interoperabilidad y experiencia de uso:

| Criterio | Microsoft Project de escritorio | CONSTRUCTA |
|---|---|---|
| Orientación | Planificación profesional de propósito general, con un motor de programación maduro. | Gestión de procesos específicamente vinculados con la ejecución en obra y la comunicación de campo. |
| Cronograma | Gantt, jerarquías, dependencias, adelantos y demoras, ruta crítica. | Gantt, subtareas (WBS), cuatro tipos de dependencia, desfases, ruta crítica (CPM) y línea base. |
| Captura de campo | No prevista; requiere carga manual desde el escritorio. | Asistente de WhatsApp: reporte de estado, notas de voz de bitácora, consulta de planos. |
| Interoperabilidad | Formato de archivo propio; exportación posible a XML. | Importación de tareas desde Excel, CSV y XML exportado por Microsoft Project. |

CONSTRUCTA no busca replicar por completo a Microsoft Project, sino conservar conceptos conocidos —Gantt, dependencias, responsables, línea base y seguimiento— y sumar integración con procesos cotidianos de obra. Su diferenciación propuesta es recibir texto, audio y archivos mediante un canal conversacional, vincularlos con entidades concretas del proyecto y mantener confirmación y trazabilidad dentro del sistema. Un chatbot como capa intermedia sobre mensajería móvil ya fue documentado en la literatura reciente como mecanismo efectivo para reducir la carga de generar reportes de obra, frente a dejar la mensajería sin estructurar (Cho et al., 2023). La reducción de fricción continúa siendo una hipótesis de diseño que deberá medirse mediante pruebas con usuarios.

### Diseño

#### Pantallas (interfaz de usuario)

La aplicación web se organiza por estado de navegación (sin enrutador de URL): un portafolio de obras y, al seleccionar una, una vista de detalle con pestañas (Resumen, Tareas, Responsables, Alertas, Historial, Presupuesto, Planos). El diseño visual emplea una identidad propia (paleta con naranja de acción `#FF6B35`, tipografías Plus Jakarta Sans y JetBrains Mono) con estilos en línea.

> **[FIGURA 2: Captura del portafolio de obras (panel principal). Fuente: elaboración propia.]**
> **[FIGURA 3: Captura del diagrama de Gantt con dependencias y ruta crítica. Fuente: elaboración propia.]**
> **[FIGURA 4: Captura de la planilla de tareas con selección de rango y relleno por arrastre. Fuente: elaboración propia.]**
> **[FIGURA 5: Captura del módulo de presupuestos (comparación con recomendación de IA). Fuente: elaboración propia.]**

#### Arquitectura del software

CONSTRUCTA adopta una **arquitectura cliente–servidor de tres capas**, desplegable en la nube:

- **Capa de presentación:** aplicación de página única (React + TypeScript), servida estáticamente y comunicada con el servidor por HTTP/JSON y por *websockets* (Socket.IO).
- **Capa de servicios (backend):** API REST construida con FastAPI, organizada en *routers* (endpoints), *services* (lógica de negocio), *repositories* (acceso a datos) y *schemas* (validación). El servidor expone, además, un *endpoint* de *webhook* que recibe los mensajes entrantes de WhatsApp.
- **Capa de datos:** base de datos relacional PostgreSQL, con esquema versionado mediante migraciones Alembic hasta la versión `0044`.
- **Integraciones externas:** API de WhatsApp (Twilio), modelos de IA (Anthropic Claude y reconocimiento de voz), y correo transaccional (Brevo).

El aislamiento entre empresas se resuelve a nivel de aplicación con un identificador de inquilino (*tenant*) que filtra las consultas de obras, responsables, alertas, usuarios y bitácora.

El sistema opera bajo dos flujos característicos:

1. **Flujo de aplicación web (petición–respuesta):** el navegador realiza llamadas HTTP/JSON a la API; el *router* valida la entrada con un esquema, delega la lógica en el *service*, este accede a los datos por el *repository*, y la respuesta vuelve al cliente. Cuando un cambio debe reflejarse en otros usuarios conectados (una nueva alerta, la presencia de un par, una edición concurrente), el servidor lo emite por Socket.IO sin que el cliente deba volver a consultar.

2. **Flujo de campo (orientado a eventos):** cuando un responsable envía un mensaje de WhatsApp, el proveedor de mensajería invoca el *webhook* del sistema. El servidor identifica al emisor por su número, recupera o crea su sesión de conversación y avanza la máquina de estados del asistente. Si el mensaje es una nota de voz, se dispara el procesamiento de inteligencia artificial (transcripción y análisis), cuyo resultado se persiste y se notifica en tiempo real a la aplicación web. De este modo, un hecho ocurrido en el campo actualiza el plan sin intervención manual.

> **[FIGURA 6: Diagrama de arquitectura de tres capas con las integraciones externas. Fuente: elaboración propia.]**

#### Flujo de chatbot y bitácora (diagrama de secuencia)

La Figura 7 detalla, a nivel de secuencia, los dos flujos centrales del sistema: la actualización de una tarea a partir de una respuesta estructurada por WhatsApp, y el procesamiento de una nota de voz de bitácora con IA —ambos atravesando el webhook de Twilio, el backend y la actualización en tiempo real por Socket.IO.

> **[FIGURA 7: Diagrama de secuencia del chatbot de tareas y la bitácora de obra en tiempo real. Fuente: elaboración propia.]**

#### Diseño de datos

El modelo de datos, versionado en cuarenta y cuatro migraciones (`0001` a `0044`), se organiza en torno a la entidad **obra** como agregado central y se compone de las siguientes entidades principales:

- **Identidad y organización:** `tenants` (empresas, con su `plan`), `users` (usuarios con rol y número de WhatsApp), `settings`.
- **Obra y planificación:** `obras` (con datos del comitente), `tasks` (con auto-referencia `parent_task_id` para subtareas y una tabla intermedia de dependencias que registra el tipo —FS/SS/FF/SF— y el desfase), `baselines` (líneas base de tareas), `calendar` (calendario laboral).
- **Equipo:** `responsibles` (directorio de personas) y `obra_team_members` (relación muchos-a-muchos entre responsables y obras, con rol).
- **Comunicación y campo:** `messages` y `conversation_sessions` (estado del asistente de WhatsApp), `bitacora_entries` (notas de voz con su transcripción, resumen y sugerencias), `historial` (registro de eventos *append-only*), `alerts`.
- **Compras y documentación:** `suppliers`, `task_materials`, `solicitudes_cotizacion` (pedidos de cotización), `purchase_orders` (con sus ítems), `budgets` (presupuestos leídos por IA) y `planos` (documentación versionada).

El aislamiento entre empresas se materializa con la columna `tenant_id` en las entidades de cabecera. Las relaciones clave son: una empresa tiene muchos usuarios y muchas obras; una obra tiene muchas tareas, alertas, entradas de bitácora, presupuestos y planos; una tarea pertenece a una obra, puede tener una tarea padre, se relaciona con otras por dependencias y se asigna a un responsable.

> **[FIGURA 8: Diagrama entidad-relación (DER) del modelo de datos. Referencia: `docs/database.md`. Fuente: elaboración propia.]**

**Máquina de estados de Tarea y de Obra**

El estado de una tarea sigue una máquina de estados validada por el backend, resumida en la Figura 9. Este modelo combina transiciones automáticas —disparadas por la respuesta del responsable vía WhatsApp— con la posibilidad de intervención manual del jefe de obra en casos excepcionales.

> **[FIGURA 9: Diagrama de estados de la entidad Tarea (VALID_TRANSITIONS, task_service.py): transiciones automáticas vía WhatsApp/IA (chatbot) y override manual del jefe de obra. Fuente: elaboración propia.]**

El mismo patrón de diseño —un motor automático con posibilidad de intervención manual— se replica a nivel de obra (Figura 10), donde el estado se recalcula automáticamente a partir de las tareas activas, salvo que el jefe de obra lo haya fijado manualmente en Pausada o Cancelada.

> **[FIGURA 10: Diagrama de estados de la entidad Obra (recompute_obra_status(), task_service.py). Fuente: elaboración propia.]**

#### Patrones de diseño

- **Capas / separación de responsabilidades:** *router → service → repository* en el backend, aislando la lógica de negocio del acceso a datos.
- **Repositorio (Repository):** abstracción del acceso a datos sobre el ORM.
- **Máquina de estados:** el flujo conversacional del asistente de WhatsApp se modela como una secuencia de pasos con estado persistido (`conversation_sessions`).
- **Registro append-only:** el historial de eventos de obra es inmutable a nivel de aplicación, garantizando trazabilidad.

### Implementación

**Enfoque de desarrollo.** La construcción se abordó de forma **incremental**, con una rama de control de versiones (Git) por cada etapa del plan, integrada al tronco principal tras su verificación. Cada cambio en el modelo de datos se materializó en una migración versionada (cuarenta y cuatro en total, `0001` a `0044`), de modo que el esquema de la base pudiera evolucionar de manera reproducible. La cronología completa del desarrollo, con sus decisiones y validaciones, se documenta en `docs/documentacion.md`.

**Organización del equipo.** El desarrollo es realizado por Martina Becerra, Facundo Graffigna y Agustín Llancamán mediante una modalidad colaborativa, sin una división permanente entre documentación y código. Cada integrante toma actividades según las necesidades del proyecto y su disponibilidad académica, lo que permite compartir el conocimiento de distintas partes de la solución. El equipo mantiene una reunión semanal de seguimiento para revisar avances, dificultades y próximos pasos, y utiliza un grupo de WhatsApp para comunicar de manera asincrónica qué actividad está realizando cada integrante y su estado.

**Dedicación y seguimiento.** La intensidad de trabajo varía entre semanas debido a parciales, exámenes finales y otras obligaciones académicas. En consecuencia, no existe una cantidad semanal uniforme por integrante ni se llevó un registro contemporáneo de horas —lo que motivó la estimación de horas-persona a partir del cronograma que se presenta en Impacto económico, en lugar de un registro real. Esta flexibilidad permitió redistribuir el esfuerzo, pero limita la estimación precisa del costo de desarrollo y dificulta reconstruir responsabilidades. Para el cierre del proyecto se propone conservar la reunión semanal y sumar, por entregable, un responsable principal, estado, fecha objetivo y evidencia de aceptación, además de un registro simple de horas por rangos.

**Magnitud de la implementación.** Auditado por conteo directo sobre el repositorio al 13 de agosto de 2026, el backend se organiza en 25 archivos de rutas —agrupables en 16 dominios funcionales (autenticación, usuarios/equipo, obras, tareas, ruta crítica, alertas, bitácora, presupuestos, planos, proveedores, materiales, órdenes de compra, importación/exportación, *webhooks*, administración e infraestructura transversal)—, apoyados en 22 archivos de modelos (33 clases) y 16 servicios de negocio. El frontend contiene 10 páginas y 35 componentes reutilizables.

A continuación se describen los módulos que componen la solución:

- **Módulo de autenticación y multi-inquilino:** registro de empresa, inicio de sesión con tokens JWT, gestión de roles (administrador / colaborador) e invitaciones de equipo por correo. Todas las consultas se filtran por el identificador de empresa (*tenant*); las dos rutas sin filtro que había señalado la auditoría del 13/08/2026 (presencia y simulación de vencidos administrativa) quedaron corregidas el 26/08/2026. Incorpora un esquema de **planes** (Básico, Pro, Enterprise) con límites de obras, usuarios y tareas: al superarse un límite, la API responde con el código HTTP 402 (*Payment Required*) y el frontend ofrece la mejora de plan.
- **Módulo de obras y tareas:** alta de obra mediante asistente de cuatro pasos y gestión completa de tareas con fechas, porcentaje de avance, hitos, subtareas (WBS, vía `parent_task_id`) y dependencias en sus cuatro tipos (FS, SS, FF, SF) con desfase. Incluye la **reprogramación en cascada**: al modificar las fechas de una tarea con sucesoras, el sistema recorre el grafo de dependencias y ofrece una vista previa de las tareas afectadas antes de confirmar, registrando un único evento en el historial. Además, cuando una fecha de inicio o de fin cae en un día no laboral (fin de semana o feriado del calendario de la obra), el sistema la **ajusta automáticamente al día laboral más cercano** en lugar de rechazar la operación, e informa el ajuste realizado.
- **Módulo de cronograma (Gantt):** visualización interactiva del cronograma con arrastre y redimensionado de barras, vistas de semana, mes y trimestre y **zoom continuo** (gesto de pellizco del *trackpad* o Ctrl+rueda, anclado al punto bajo el cursor) que permite ajustar el nivel de detalle desde una tarea individual hasta la obra completa. Las **subtareas se agrupan inmediatamente debajo de su tarea padre** (jerarquía WBS) y las **dependencias** se hacen explícitas por partida doble: con flechas sobre la línea de tiempo y con una etiqueta en la columna de tareas (que se omite cuando la predecesora es la propia tarea padre, por redundante). Incluye **cálculo de ruta crítica (CPM)** y superposición de la **línea base** para comparar lo planificado con lo replanificado, además de edición y eliminación de tareas desde la propia fila.
- **Módulo de planilla de tareas:** vista de edición tipo hoja de cálculo con selección de celdas y rangos, relleno por arrastre con encadenado automático de fechas, copiar/pegar de bloques y deshacer. La planilla replica la experiencia de una hoja de cálculo real: **zoom continuo** (gesto de pellizco del *trackpad*, anclado al cursor) que revela más o menos celdas, una **grilla que se extiende más allá de los datos** —con desplazamiento hacia celdas vacías como en una hoja de cálculo—, alta de tareas escribiendo directamente sobre cualquier celda vacía e **inserción de filas en cualquier posición del orden** (que se persiste). El usuario puede **mostrar u ocultar columnas** según su necesidad; además de las de planificación, dispone de columnas opcionales de **hito**, **dependencias** y **costo de materiales** (esta última, un resumen que vincula la planilla con el presupuesto de la tarea). Se complementa con **importación** desde Excel, CSV y MS Project (mapeo de WBS, recursos y dependencias) y **exportación** a Excel, además de una plantilla descargable.
- **Módulo de alertas y tiempo real:** un servicio evalúa automáticamente los riesgos de cada obra (tareas vencidas, demoradas o bloqueadas, sin responsable, y alto porcentaje de vencimiento) y genera alertas de distintos tipos —tarea bloqueada, riesgo de demora, tarea vencida, sin respuesta, reprogramación solicitada y recepción de pedido—. La evaluación combina un chequeo reactivo (al abrir una obra) con un job periódico cada 4 horas que cubre obras sin tráfico, y cada alerta se auto-resuelve cuando la condición que la disparó desaparece (tarea completada, cancelada o corregida). Las alertas se emiten en tiempo real por Socket.IO y quedan trazadas en el historial. El mismo canal soporta la presencia de usuarios conectados y la edición colaborativa.
- **Módulo de asistente de WhatsApp:** un *webhook* recibe los mensajes entrantes; el sistema identifica al emisor (responsable de tareas o personal de la empresa) por su número y conduce la conversación mediante una **máquina de estados** (estados: reposo, selección de obra, selección de tarea, menú de estado y espera de fecha), persistida en la base. Permite reportar el estado de una tarea, registrar notas de voz y consultar planos.
- **Módulo de bitácora de obra con IA:** convierte una nota de voz en información estructurada mediante una cadena de procesamiento: el audio se transcribe con un modelo de reconocimiento del habla (`gpt-4o-mini-transcribe`) y el texto resultante se analiza con un modelo de lenguaje (Claude Haiku 4.5) configurado con **salida estructurada (JSON Schema)**. El análisis produce un resumen de dos a cuatro oraciones, una lista de puntos clave y un conjunto de **sugerencias aplicables** sobre el plan —reprogramar una tarea, crear una tarea, cambiar un estado o dejar una nota—, cada una con una cita del audio que la justifica. Si el audio no contiene nada accionable, no se fuerzan sugerencias. El modelo recibe el **calendario laboral** de la obra para proponer fechas en días hábiles, y las sugerencias se revisan y aplican (Sí/No) desde la aplicación —un módulo propio de cada obra— donde un indicador por obra señala las que quedan pendientes. Para no perder ninguna nota, si una nota de voz llega sin obra (un emisor con varias obras que no indicó cuál), el sistema le **recuerda automáticamente al emisor cada 30 minutos** —en horario laboral, hasta 48 horas— que la asigne; y si aun así no responde, la nota queda visible en una sección **"Sin asignar"** para que el jefe de obra la asigne manualmente, garantizando la trazabilidad. Antes de aplicar una sugerencia, el jefe puede **editarla** (ajustar fechas, título, responsable o estado): la IA propone y él decide. Cuando una sugerencia se aplica, el sistema **le confirma por WhatsApp a quien envió la nota** qué se hizo, cerrando el círculo del reporte; y la llegada de una nota nueva se anuncia al instante con una **notificación en tiempo real** (Socket.IO) al equipo de la obra. La trazabilidad tarea → nota está completa: desde una tarea se accede a las **notas de voz que la originaron o modificaron**, con el audio reproducible y la cita que lo justifica. La dirección inversa (desde una nota hacia el detalle de la tarea) todavía no tiene *click-through*: la sugerencia muestra el nombre de la tarea como texto plano. El historial de notas se explora con **búsqueda y filtros** (por texto o responsable, por tipo de acción y por fecha).
- **Módulo de presupuestos con IA:** acepta presupuestos de proveedores en múltiples formatos (PDF, imagen, Excel o texto) y, con el mismo modelo de lenguaje, extrae sus datos a una estructura validada (proveedor, fecha, rubro, moneda, ítems con cantidad/unidad/precio/subtotal, IVA, total, flete, plazo de entrega, condiciones de pago y validez). Detecta **inconsistencias** (por ejemplo, totales que no cierran o faltantes de precios) con su severidad, y **compara** varios presupuestos calculando el promedio, el más económico y el desvío porcentual de cada uno.
- **Módulo de planos:** repositorio de documentación con **versionado** por obra y disciplina; marca la última versión vigente y permite su consulta y envío por WhatsApp, evitando que en el campo se trabaje sobre planos desactualizados. La interfaz presenta *planos* —cada uno con su versión vigente y su historial de revisiones— y no archivos sueltos: subir una revisión nueva se resuelve desde la fila del plano correspondiente, de modo que el nombre del archivo entrante resulta irrelevante y no puede abrir un historial paralelo por una diferencia de tipeo. La regla de vigencia es deliberadamente simple y explicable en una línea: manda la última versión cargada, y si eso resulta incorrecto se corrige marcando otra a mano. El **acceso por responsable** se controla por obra: por defecto quien integra el equipo puede consultar cualquier disciplina —criterio alineado con la práctica de obra, donde las especialidades se interconectan y el electricista puede necesitar el plano sanitario—, y esa apertura se restringe manualmente, ya sea quitando el acceso por completo o habilitando solo disciplinas puntuales.
- **Módulo de materiales, presupuesto y compras:** cómputo de materiales por tarea (con unidad, precio unitario y estado de aprovisionamiento), presupuesto por obra (estimado frente a real) y un flujo de **solicitudes de cotización**: desde la obra se seleccionan los materiales pendientes y los proveedores a consultar; el sistema genera un PDF de solicitud y lo envía a cada proveedor por WhatsApp. Cuando el proveedor responde con su presupuesto en PDF —también por WhatsApp—, el sistema lo detecta, lo descarga y delega en el módulo de presupuestos la extracción estructurada con IA. Con dos o más respuestas, se dispara automáticamente un **análisis comparativo** (Claude con salida estructurada JSON Schema) que compara los presupuestos ítem por ítem, identifica ventajas y riesgos de cada proveedor y emite una recomendación fundamentada. Al confirmar el proveedor elegido, se genera la **orden de compra** y los materiales pasan al estado "pedido".

### Pruebas

La estrategia de verificación combinó distintos niveles:

- **Plan de pruebas:** se mantiene un conjunto de casos de prueba manuales documentados en `docs/casos_de_prueba.md`.
- **Pruebas funcionales y de aceptación:** cada módulo se verificó ejecutando la aplicación en el navegador contra el backend real, comprobando el comportamiento esperado de las interacciones (por ejemplo, el relleno por arrastre con encadenado de fechas persistiendo en la base, o el flujo completo de la bitácora por voz).
- **Pruebas de integración:** se verificaron de extremo a extremo los flujos que atraviesan varias capas e integraciones, como el envío de una nota de voz por WhatsApp → transcripción → análisis con IA → registro en la bitácora, y la lectura y comparación de presupuestos con el modelo de lenguaje.
- **Verificación de regresiones:** ante cada cambio se ejecutó la verificación de tipos (`tsc`) y la compilación de producción del frontend, y se realizó una auditoría general de la aplicación documentada en `docs/auditoria-general.md`.
- **Auditoría técnica sistemática:** se auditó el sistema módulo por módulo —las 25 rutas del backend, los servicios y el modelo de datos— con ocho análisis (`docs/analisis-modulo-*.md`) consolidados en un informe maestro (`docs/auditoria-sistema-consolidada.md`) que clasifica los hallazgos por severidad (seguridad / robustez / pulido) e identifica como tema transversal principal el aislamiento entre empresas (*tenants*). Tras la defensa se realizó una segunda ronda sistemática, módulo por módulo, documentada en once informes (`docs/auditoria/01` a `11`), cuya remediación se completó entre el 21 y el 28 de agosto de 2026. La suite automatizada creció a 315 tests distribuidos en 37 archivos, ejecutados en integración continua ante cada cambio: aislamiento por tenant (`test_tenant_isolation.py`, que verifica que un usuario de una empresa no accede a los recursos de otra), permisos por obra, autenticación, *rate limiting*, importaciones, robustez de infraestructura y un archivo por módulo auditado. Los tests de frontend y la automatización end-to-end quedan pendientes; se declaran explícitamente en las secciones de Implementación y de Objetivos no cumplidos.
- **Prueba en entorno real como fuente de hallazgos:** la verificación contra la integración real de mensajería (Twilio/WhatsApp), y no solamente la lectura de código o la suite automatizada, expuso defectos que ninguna de las otras técnicas había detectado: un menú de desambiguación que no aceptaba el nombre de la obra como respuesta y dejaba al usuario en un ciclo sin salida; un valor por defecto invertido en la asignación de permisos, latente porque ninguna interfaz ejercitaba ese camino; y un límite de tamaño de la plataforma de mensajería que el sistema no comunicaba. Se documenta como aprendizaje metodológico: en un sistema cuya interfaz principal es un canal de terceros, la prueba de integración real resulta una técnica de verificación no sustituible.

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
| Plano pedido en varias obras | Solicitar por WhatsApp una disciplina presente en más de una obra del responsable y responder con el nombre de la obra en lugar del número | El sistema entrega la versión vigente de la obra indicada, aceptando indistintamente el número o el nombre. |
| Acceso restringido a planos | Quitar el acceso a planos de un responsable y solicitar un plano desde su número | El asistente responde que no tiene acceso, sin entregar el archivo. |
| Plano por encima del límite de mensajería | Cargar un plano de más de 16 MB | La carga se completa y la interfaz advierte que no podrá enviarse por WhatsApp, sin bloquear la operación. |

> **Estado de la cobertura automatizada.** El backend cuenta con 315 tests automatizados (*pytest*, 37 archivos) corriendo en integración continua. No existen todavía pruebas automatizadas de frontend (*Vitest* u otro) ni de extremo a extremo (*Playwright*); se deja declarada esta brecha como parte de los objetivos pendientes del proyecto.

---

## Beneficios post-implementación

- **Reducción de la fricción de adopción:** el personal de campo reporta desde el WhatsApp que ya utiliza, sin instalar ni aprender una aplicación nueva.
- **Trazabilidad de la comunicación de obra:** lo que antes se perdía en chats queda registrado, asociado a la obra y a la tarea, en un historial *append-only*.
- **Detección temprana de desvíos:** las alertas automáticas y la ruta crítica permiten anticipar el impacto de una demora antes de que afecte a tareas posteriores.
- **Disminución del retrabajo de carga:** la información de campo llega estructurada (transcrita y resumida por IA), evitando la transcripción manual.
- **Mejor toma de decisiones en compras:** la lectura y comparación automática de presupuestos permite elegir proveedor ponderando precio, plazo y condiciones, y advierte inconsistencias.
- **Acceso a la documentación vigente desde el campo:** los responsables obtienen la última versión de un plano por WhatsApp, evitando trabajar sobre planos desactualizados.

**Métricas objetivo.** Los beneficios anteriores se plantean como hipótesis de diseño validadas cualitativamente durante el relevamiento de campo (Marco teórico), no como resultados medidos. Una vez que el sistema esté en uso, se proponen como métricas a relevar: el porcentaje de reducción en el tiempo de carga de avances de obra respecto del método previo, la cantidad de notas de voz de bitácora registradas por semana y por obra, y el tiempo transcurrido entre un reporte de campo (por WhatsApp) y su reflejo en el plan de la obra.

---

## Impacto económico (estudio de costos)

**Costos de implementación (desarrollo).** Corresponden al esfuerzo de ingeniería para construir la plataforma. Al tratarse de un proyecto integrador universitario, sin facturación real ni contratación del equipo, este esfuerzo se reporta en horas-persona invertidas por el equipo durante el desarrollo, sin convertirlas a un costo monetario de desarrollo (a diferencia de los costos de operación, que sí corresponden a servicios pagos reales y se expresan en dólares más abajo). Aparte de este esfuerzo, el equipo incurrió en gastos directos de suscripciones personales a herramientas de IA para asistir el desarrollo (editores de código e IA conversacional); esa cifra es un costo del proceso de construcción, distinto tanto de las horas-persona como de los costos de operación del producto ya en uso por un cliente. Concretamente, el equipo mantiene tres cuentas individuales de Claude y tres de ChatGPT, a USD 20 mensuales cada una, lo que totaliza USD 120 mensuales brutos (sin impuestos, recargos ni diferencias de cambio); el costo acumulado durante el desarrollo se obtiene multiplicando esa cifra por la cantidad de meses abonados, y todavía resta definir qué proporción de ese gasto es atribuible específicamente a CONSTRUCTA frente a otros usos personales de esas suscripciones. Los costos de operación del producto ya en uso por un cliente se detallan a continuación.

**Estimación de referencia a partir del cronograma.** A falta de un registro de horas real, se utiliza el cronograma del proyecto (Gantt) como base de estimación: las tareas del cronograma ya ejecutadas suman 483 tareas-día de duración planificada. Asumiendo un promedio de 4 horas efectivas de trabajo por tarea-día (compatible con la dedicación part-time de un equipo de estudiantes), esto arroja una estimación de referencia de aproximadamente 1.930 horas-persona, equivalentes a un promedio de unas 640 horas por integrante. Se trata de una aproximación metodológica a partir del cronograma, no de un registro real de horas trabajadas, que se puede reemplazar por cifras exactas a medida que el equipo lleve un registro de horas por integrante.

**Costos de operación (mensuales, por empresa cliente).**

| Concepto | Detalle | Costo de referencia |
|---|---|---|
| Hosting backend + base de datos | Plataforma en la nube (p. ej. Railway/Render) | USD 20–30/mes (plan Pro de Railway; incluye backend y PostgreSQL con margen de cómputo) |
| Hosting frontend | Servido estático (p. ej. Vercel) | USD 0/mes en el nivel gratuito de un proveedor de hosting estático (hasta cierto volumen de tráfico) |
| Mensajería WhatsApp | Por mensaje/conversación (Twilio) | USD 0,005/mensaje (tarifa de plataforma de Twilio) sobre mensajes gratuitos de Meta dentro de la ventana de conversación de servicio de 24 h |
| Modelos de IA | Transcripción de voz y análisis de texto/documentos | ≈USD 0,01 por nota de voz de 2 minutos (verificado en pruebas) |
| Correo transaccional | Invitaciones de equipo | USD 0/mes en el nivel gratuito de bajo volumen del proveedor |

A modo de referencia verificada durante las pruebas, el costo de procesar una nota de voz de obra —que comprende dos llamadas a modelos de IA: la transcripción del audio y su posterior análisis con salida estructurada— se ubicó en el orden de **un centavo de dólar por audio de dos minutos**. Esto indica que el costo variable de IA por uso es marginal frente al valor que aporta, y que la elección de modelos de bajo costo por operación (un modelo de reconocimiento del habla económico y un modelo de lenguaje de la familia Haiku) es determinante para la sustentabilidad del modelo de negocio.

**Ahorros potenciales para el cliente.** El principal ahorro es el **tiempo de coordinación** que hoy se pierde en transcribir avances, perseguir respuestas y reconstruir lo acordado, además del costo evitado por **demoras detectadas tarde**.

**Modelo de ingresos.** El sistema contempla planes por suscripción (Básico, Pro y Enterprise) con límites de obras, usuarios y tareas, lo que define el potencial de retorno de la inversión.

---

## Impacto social

- **Beneficio o impacto positivo general:** la mejora en la coordinación y la trazabilidad de las obras contribuye a reducir conflictos entre las partes (empresa, comitente, contratistas) y a profesionalizar la gestión en un sector tradicionalmente informal.
- **Segmentos de la población beneficiados:** pequeñas y medianas empresas constructoras y profesionales independientes (arquitectos), que acceden a capacidades de planificación antes reservadas a grandes organizaciones con software costoso.
- **Solidaridad y apoyo a segmentos vulnerables / Inclusión y reducción de brechas:** al usar WhatsApp como canal de campo, la herramienta es accesible para personal de obra con baja familiaridad tecnológica, sin requerir la compra de equipamiento ni capacitación específica; esto reduce la brecha digital en la adopción de tecnología en la construcción.
- **Profesionalización y valorización del trabajo de campo:** el conocimiento del responsable de obra, que hoy queda en su teléfono y rara vez llega estructurado a quien planifica, pasa a integrarse formalmente al plan a través de sus reportes y notas de voz. Esto le da al personal de campo un rol activo y trazable en la toma de decisiones, en lugar de un lugar puramente ejecutor cuyo aporte informal se pierde.
- **Reducción de conflictos entre las partes:** buena parte de los conflictos contractuales en obra —entre empresa, comitente y contratistas— se originan en desacuerdos sobre qué se informó, cuándo y a quién. Al dejar un historial trazable de reportes, respuestas y cambios de estado, el sistema reduce el espacio para ese tipo de disputa, en línea con la magnitud del problema de coordinación documentada por McKinsey & Company (2017) en el Diagnóstico.
- **Generación de datos para políticas sectoriales:** a mediano plazo, la adopción del sistema por un número relevante de obras generaría datos agregados sobre demoras, causas de retraso y patrones de coordinación —información que hoy no se releva de forma sistemática en el sector de pequeña y mediana escala— y que podría aportar a estudios o iniciativas de la Cámara Argentina de la Construcción sobre productividad del sector.

---

## Impacto medioambiental

- **Minimización de residuos y desperdicios:** la digitalización de planos, presupuestos y la bitácora reduce el uso de papel en obra.
- **Uso eficiente de recursos:** la mejor planificación (ruta crítica, detección temprana de desvíos) tiende a reducir el retrabajo y el desperdicio de materiales asociado a errores de coordinación.
- **Impacto indirecto en la conciencia ambiental:** la trazabilidad del consumo de materiales (módulo de cómputo y compras) habilita, a futuro, el seguimiento del uso de recursos por obra.
- **Prevención de sobrecompra y desperdicio de materiales:** la detección automática de inconsistencias entre presupuestos de proveedores (ítems duplicados, cantidades que no cierran contra el cómputo de la tarea) reduce el riesgo de pedidos de materiales por encima de lo necesario, una fuente frecuente de desperdicio físico en obra.
- **Reducción de traslados innecesarios:** al poder consultar por WhatsApp la última versión vigente de un plano desde el sitio de obra, se evitan viajes a la oficina técnica o entre obras solo para verificar o retirar documentación actualizada, con la consecuente reducción de emisiones asociadas a esos traslados.

---

## Conclusión

El proyecto CONSTRUCTA aborda la desconexión entre la planificación y la ejecución en obra mediante una plataforma web que conecta el cronograma con el campo a través de un asistente de WhatsApp. El desarrollo dio implementación concreta a los doce objetivos específicos del Anteproyecto (Tabla de trazabilidad), aunque su grado de cierre no es uniforme: la gestión integral de obras y tareas, el chatbot estructurado con intervención manual, el cronograma con ruta crítica, el módulo de alertas, la documentación técnica centralizada y la bitácora de obra asistida por IA quedan implementados; el panel de indicadores, el historial y el módulo de aislamiento multi-tenant quedan implementados con salvedades puntuales de alcance o de seguridad ya detalladas en la Tabla de trazabilidad. Durante el desarrollo se sumaron, además, capacidades no comprometidas originalmente —planificación avanzada (WBS, ruta crítica, línea base), planilla de carga masiva, gestión de presupuestos con IA y solicitudes de cotización, y arquitectura multi-inquilino con planes—, que demuestran capacidad de evolución del equipo pero deben evaluarse por separado del núcleo aprobado, para no ocultar su cumplimiento.

Entre los principales aprendizajes del desarrollo se destacan: la importancia de **minimizar la fricción de adopción** como criterio de diseño rector; el valor de los modelos de lenguaje con **salida estructurada** para convertir lenguaje natural (mensajes y notas de voz) en datos accionables de forma confiable; y la necesidad de **verificar en condiciones reales** —ejecutando la aplicación y los flujos de integración— para detectar problemas que las verificaciones de compilación no revelan.

El hito de MVP fue evaluado por docentes de la asignatura Administración de Proyectos y obtuvo calificación 10. Esta instancia respalda la calidad académica del avance presentado en ese momento, aunque se diferencia de una prueba de aceptación con usuarios finales: los encuentros con profesionales y con RODE validaron cualitativamente la pertinencia del problema y orientaron decisiones de diseño, pero la utilidad y la adopción de la solución en un escenario real todavía deben comprobarse mediante un piloto.

**Reflexión sobre la organización.** La modalidad colaborativa permitió que los tres integrantes participaran tanto en código como en documentación, y que la carga pudiera redistribuirse durante semanas con evaluaciones académicas. La reunión semanal y la comunicación por WhatsApp sostuvieron la coordinación aun cuando la disponibilidad individual no fue uniforme. La principal limitación metodológica de esta modalidad fue no registrar desde el comienzo horas, responsables principales y evidencia de cierre con una estructura homogénea, lo que dificultó estimar con precisión el esfuerzo de desarrollo (véase Impacto económico).

Quedan pendientes dos tipos de aspectos, de naturaleza distinta. Por un lado, dos funcionalidades declaradas explícitamente fuera de alcance del proyecto: la notificación automática al jefe o administrador de obra cuando un responsable responde a un recordatorio (funcionalidad analizada y diseñada, no implementada) y la pasarela de pago para el cobro efectivo de los planes de suscripción. Por otro lado, una brecha real detectada durante el desarrollo: la suite automatizada cubre el backend (72 tests con pytest en 16 archivos) pero no incluye todavía pruebas automatizadas de frontend ni de extremo a extremo, ni una métrica de cobertura de código; se declara como el objetivo de calidad más importante a resolver en la siguiente etapa del proyecto.

---

## Bibliografía / Referencias

> Listado en formato APA v7. Se priorizan fuentes académicas del dominio y documentación oficial. En la versión final de Google Docs deberá verificarse, mediante la herramienta de citas, la correspondencia entre cada cita del texto y esta lista.

- Adriaanse, A., Voordijk, H., & Dewulf, G. (2010). Adoption and use of interorganizational ICT in a construction project. *Journal of Construction Engineering and Management, 136*(9), 1003–1014. https://doi.org/10.1061/(ASCE)CO.1943-7862.0000201
- Alembic. (2026). *Alembic documentation*. https://alembic.sqlalchemy.org
- Anthropic. (2026). *Claude API documentation*. Anthropic. https://docs.anthropic.com
- Autodesk. (s. f.). *Construction management software*. Recuperado el 13 de agosto de 2026, de https://construction.autodesk.com/
- Cámara Argentina de la Construcción. (2018). *Gestión y productividad de obra*. Escuela de Gestión de la Construcción. https://biblioteca.camarco.org.ar/libro/gestion-y-productividad-de-obra/
- Cho, J., Lee, G., Song, T., & Jeong, H. D. (2023). Chatbot-engaged construction daily work report using mobile messenger. *Automation in Construction, 154*, Artículo 105007. https://doi.org/10.1016/j.autcon.2023.105007
- FastAPI. (2026). *FastAPI documentation*. https://fastapi.tiangolo.com
- Kelley, J. E., & Walker, M. R. (1959). Critical-path planning and scheduling. *Proceedings of the Eastern Joint Computer Conference*, 160–173.
- Lu, H., Pishdad-Bozorgi, P., Wang, G., Xue, Y., & Tan, D. (2019). ICT implementation of small- and medium-sized construction enterprises: Organizational characteristics, driving forces, and value perceptions. *Sustainability, 11*(12), Article 3441. https://doi.org/10.3390/su11123441
- Meta Platforms. (2026). *WhatsApp Business Platform documentation*. https://developers.facebook.com/docs/whatsapp
- Microsoft. (s. f.). *Advanced capabilities with premium plans in Planner*. Recuperado el 13 de agosto de 2026, de https://support.microsoft.com/en-US/Planner/teams/advanced-capabilities-with-premium-plans-in-planner
- Microsoft Support. (s. f.). *Project help*. Recuperado el 13 de agosto de 2026, de https://support.microsoft.com/en-us/project/project-help
- Mischke, J., Stokvis, K., Vermeltfoort, K., & Biemans, B. (2024, 9 de agosto). *Improving construction productivity is the new imperative*. McKinsey & Company. https://www.mckinsey.com/capabilities/operations/our-insights/delivering-on-construction-productivity-is-no-longer-optional
- OpenAI. (2026). *Speech-to-text (audio transcription) documentation*. https://platform.openai.com/docs/guides/speech-to-text
- PostgreSQL Global Development Group. (2026). *PostgreSQL documentation*. https://www.postgresql.org/docs/
- Procore Technologies. (s. f.). *Construction project management software*. Recuperado el 13 de agosto de 2026, de https://www.procore.com/project-management
- Procore Technologies. (s. f.). *Send a message or WhatsApp to a contact (iOS)*. Procore Support. Recuperado el 19 de agosto de 2026, de https://support.procore.com/procore-mobile-ios/user-guide/directory-ios/tutorials/send-message-or-whatsapp-to-a-contact-ios
- Project Management Institute. (2021). *A guide to the project management body of knowledge (PMBOK guide)* (7th ed.). PMI.
- React. (2026). *React documentation*. Meta. https://react.dev
- Socket.IO. (2026). *Socket.IO documentation*. https://socket.io/docs/
- SQLAlchemy. (2026). *SQLAlchemy 2.0 documentation*. https://docs.sqlalchemy.org
- Twilio. (2026). *Twilio API for WhatsApp documentation*. https://www.twilio.com/docs/whatsapp
- TypeScript. (2026). *TypeScript documentation*. Microsoft. https://www.typescriptlang.org/docs/
- Xu, S., & Luo, H. (2014). The information-related time loss on construction sites: A case study on two sites. *International Journal of Advanced Robotic Systems, 11*(8), Article 128. https://doi.org/10.5772/58444

---

## Anexos

Información suplementaria, no necesaria para el entendimiento mínimo del proyecto:

- **Anexo A — Bitácora de desarrollo completa:** `docs/documentacion.md` (registro cronológico de avances, decisiones y validaciones).
- **Anexo B — Esquema de base de datos:** `docs/database.md`.
- **Anexo C — Casos de prueba manuales:** `docs/casos_de_prueba.md`.
- **Anexo D — Auditorías de la aplicación:** `docs/auditoria-general.md`, `docs/auditoria-ux.md`, `docs/auditoria-flujo-alta.md`.
- **Anexo E — Repositorio de código:** https://github.com/facugraffigna466/CONSTRUCTA
