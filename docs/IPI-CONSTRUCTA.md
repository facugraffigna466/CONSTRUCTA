# Informe de Proyecto Integrador — CONSTRUCTA

> **Cómo usar este documento.** El contenido sigue la estructura de la *Plantilla IPI v2.1 – 2026* (UCC, Facultad de Ingeniería) y está redactado en tono formal e impersonal (3.ª persona), listo para trasladar al Google Doc oficial. Los textos entre `«…»` y los bloques marcados **[COMPLETAR]** o **[PENDIENTE]** requieren datos o evidencia todavía no disponibles. Al maquetarlo, los párrafos normales deben quedar justificados y cada figura debe ser mencionada previamente, numerada, descrita, acompañada por su fuente y configurada con texto alternativo. El Resumen y el Abstract no deben exceder las 300 palabras cada uno. Las citas y referencias deben ajustarse a APA 7.

---

## Portada

**Universidad Católica de Córdoba**
**Facultad de Ingeniería**

**Proyecto: CONSTRUCTA — Plataforma de gestión de obras de construcción con asistente de WhatsApp**

Informe Final de Grado

**Alumnos:**
- Becerra, Martina
- Graffigna, Facundo
- Llancaman, Agustín

**Directores:**
- Porrini, Federico Eduardo
- Carreño, Ignacio Luciano
- Juarez, Leandro

«día» de «mes» de 2026
Córdoba — Argentina

---

## Resumen

La gestión de una obra exige coordinar actores, cronogramas, documentos y decisiones producidas en distintos lugares y momentos. La bibliografía identifica la fragmentación y las deficiencias del flujo de información como factores que pueden afectar la trazabilidad, la planificación y la productividad. *(Introducción)*

El diagnóstico combinó revisión documental y encuentros exploratorios con seis profesionales de Córdoba: cuatro arquitectas docentes con ejercicio profesional, el director de la constructora RODE y un jefe de obra de esa organización. En el flujo presentado por este último coexisten Microsoft Project, Excel y un sistema independiente para pedidos, órdenes de compra y materiales. El caso permitió observar la fragmentación entre herramientas y reconocer la adopción tecnológica como requisito de diseño, aunque la muestra no permite generalizar los resultados al sector. *(Problemática)*

Se desarrolló CONSTRUCTA, una aplicación web que conecta el cronograma con el campo mediante un asistente de WhatsApp. Los responsables pueden reportar tareas y registrar notas de voz desde el canal que ya utilizan. El sistema combina FastAPI, PostgreSQL, Socket.IO y React, e integra inteligencia artificial para transcribir y estructurar notas de obra e interpretar presupuestos de proveedores. *(Metodología — Solución)*

El prototipo integra un diagrama de Gantt con dependencias y ruta crítica; una planilla para carga masiva; importación de XML exportado por Microsoft Project; alertas; bitácora de obra por voz asistida por IA; gestión de presupuestos; y planos versionados consultables por WhatsApp. *(Resultados)*

CONSTRUCTA demuestra la viabilidad técnica de integrar planificación, información de campo y automatización. La reducción efectiva de la fricción de adopción y de los tiempos operativos deberá evaluarse mediante pruebas de usabilidad y uso real con los perfiles destinatarios. *(Conclusión)*

**Palabras clave:** gestión de obras, comunicación de obra, WhatsApp, inteligencia artificial, planificación, ruta crítica.

## Abstract

Construction management requires coordinating stakeholders, schedules, documents, and decisions produced at different places and times. The literature identifies fragmentation and deficiencies in information flow as factors that can affect traceability, planning, and productivity. *(Introduction)*

The diagnosis combined a literature review with exploratory meetings involving six professionals from Córdoba: four practicing architects who also teach, the director of the construction company RODE, and one of its site managers. The workflow presented by the latter combines Microsoft Project, Excel, and a separate system for requests, purchase orders, and materials. The case revealed fragmentation across tools and identified technology adoption as a design requirement, although the sample does not support generalization to the sector. *(Problem)*

CONSTRUCTA was developed as a web application that connects the schedule with the field through a WhatsApp assistant. Task owners can report progress and record voice notes through the channel they already use. The system combines FastAPI, PostgreSQL, Socket.IO, and React, and integrates artificial intelligence to transcribe and structure field notes and interpret supplier quotes. *(Methodology — Solution)*

The prototype integrates a Gantt chart with dependencies and critical-path analysis; a spreadsheet-like interface for bulk task entry; import of XML files exported by Microsoft Project; alerts; an AI-assisted voice work log; quote management; and versioned drawings available through WhatsApp. *(Results)*

CONSTRUCTA demonstrates the technical feasibility of integrating planning, field information, and automation. The effective reduction of adoption friction and operational time must be assessed through usability testing and real-world use with the intended profiles. *(Conclusion)*

**Keywords:** construction management, on-site communication, WhatsApp, artificial intelligence, planning, critical path.

---

## Presentación del tema

El presente proyecto integrador aborda la gestión de la información en obras de construcción, con foco en el vínculo entre la planificación y la ejecución en el campo. En una misma operación pueden coexistir herramientas formales de planificación, planillas de cálculo, sistemas administrativos y canales de mensajería. Cuando esos recursos no mantienen un flujo integrado, el avance comunicado desde la obra debe reconstruirse o cargarse nuevamente para actualizar el plan. Esta discontinuidad constituye el eje del proyecto.

El propósito de CONSTRUCTA es **conectar el plan de obra con el campo procurando preservar canales y patrones de trabajo conocidos**. La propuesta busca que la plataforma capture, estructure y registre información producida durante la ejecución mediante el canal que los responsables ya utilizan, y que la vincule con el cronograma y la documentación correspondiente.

El tema es relevante porque la construcción es una actividad intensiva en coordinación y una actualización tardía puede afectar tareas dependientes, decisiones y costos. La bibliografía y el relevamiento exploratorio indican que la compatibilidad con las prácticas existentes, el esfuerzo de aprendizaje y el valor percibido condicionan la adopción tecnológica. Por ello, reducir esa fricción constituye una oportunidad de mejora que deberá validarse con los usuarios destinatarios.

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

**Delimitación del problema.** La industria de la construcción se organiza mediante proyectos temporales en los que intervienen profesionales, contratistas, subcontratistas, proveedores y comitentes con prácticas, recursos y objetivos diferentes. Esta configuración favorece la fragmentación de la información y dificulta su circulación entre quienes planifican, coordinan y ejecutan las tareas en el sitio (Adriaanse et al., 2010).

La gestión de la información de campo constituye un componente operativo del proyecto: el estado de las actividades, las decisiones, las modificaciones, los planos y las restricciones deben llegar a las personas responsables en forma oportuna y comprensible. Tsai (2009) comprobó, mediante un estudio exploratorio de gestión de materiales, que las barreras de comunicación pueden persistir aun cuando se utilizan herramientas informáticas. Xu y Luo (2014), a partir de la observación directa de dos obras, relacionaron las pérdidas de tiempo con tres problemas de información: inconsistencia, deslocalización —la información no llega a la persona adecuada en el momento requerido— y ambigüedad. Por tratarse de estudios realizados fuera de la Argentina y sobre casos específicos, sus resultados no se extrapolan estadísticamente al segmento objetivo, pero permiten explicar los mecanismos por los cuales una circulación deficiente de la información puede producir esperas, negociaciones, retrabajos y demoras.

El problema se desarrolla, además, dentro de un sector con desafíos estructurales de productividad. El McKinsey Global Institute (2017) estimó que, durante las dos décadas analizadas, la productividad laboral global de la construcción creció aproximadamente un 1 % anual, frente al 2,8 % de la economía mundial y al 3,6 % de la industria manufacturera. El rezago es multifactorial y no puede atribuirse únicamente a la comunicación; el informe incluye, entre otros factores, la fragmentación, las deficiencias de gestión y la baja adopción de herramientas digitales. En el contexto argentino, una encuesta de la Cámara Argentina de la Construcción a 90 empresas de entre 15 y 150 empleados señaló la falta de registros y la escasez de mecanismos sistemáticos para obtener y analizar datos de gestión de obra (Cámara Argentina de la Construcción, 2018).

El relevamiento cualitativo realizado por el equipo aportó evidencia local en la misma dirección. Durante junio de 2026 se mantuvieron encuentros exploratorios con seis informantes vinculados con obras en Córdoba: cuatro arquitectas docentes de la Universidad Católica de Córdoba con actividad profesional y estudios propios, el director de la empresa constructora RODE y un jefe de obra de esa organización. En el flujo presentado por el jefe de obra coexisten Microsoft Project para la planificación, Microsoft Excel para distintos registros y un sistema independiente para pedidos, órdenes de compra y materiales. Este caso no representa por sí solo al conjunto del sector, pero permite observar de manera concreta la fragmentación entre herramientas dentro de una operación real.

**Problema central y validación exploratoria.** A partir de la bibliografía y del relevamiento propio, el proyecto define como problema la discontinuidad entre:

1. la planificación formal, registrada en cronogramas, planillas o aplicaciones de gestión; y
2. la información producida durante la ejecución, que circula mediante conversaciones, llamadas, mensajes y archivos distribuidos.

El problema central no sería, por lo tanto, la inexistencia de herramientas de planificación, sino la falta de un flujo continuo y trazable entre el dato generado en obra y el registro utilizado para controlar el proyecto. Esta discontinuidad expone a los interesados a los siguientes riesgos:

| Riesgo | Consecuencia posible |
|---|---|
| Pérdida de contexto y trazabilidad | Una decisión no queda vinculada con la obra, la tarea, el responsable y el momento en que se tomó. |
| Actualización tardía del cronograma | Los desvíos pueden detectarse después de afectar actividades dependientes. |
| Duplicación de carga | La información recibida por un canal debe transcribirse manualmente a otro sistema. |
| Información incompleta o ambigua | Aumenta la necesidad de aclaraciones y la probabilidad de registrar datos incorrectos. |
| Documentación distribuida | Puede consultarse una versión desactualizada de un plano, presupuesto u otro archivo. |
| Dependencia de conocimiento individual | El estado real de la obra queda sujeto a la memoria o disponibilidad de una persona. |

**Factores causales.** La incorporación de tecnología no garantiza por sí sola la resolución del problema. Adriaanse et al. (2010) identificaron cuatro grupos de factores que condicionan el uso efectivo de tecnologías de información y comunicación en proyectos de construcción: motivación personal, motivación externa, conocimientos y habilidades, y oportunidades reales de uso dentro del trabajo. En pequeñas y medianas empresas constructoras, la adopción también depende de las características organizacionales, la orientación estratégica y el valor percibido de la tecnología (Lu et al., 2019). Estos antecedentes fundamentan que la facilidad de aprendizaje, el esfuerzo de carga y la compatibilidad con las prácticas existentes deben considerarse requisitos de diseño, no efectos automáticos de una aplicación.

**Oportunidad y población destinataria.** La oportunidad consiste en investigar un mecanismo que reduzca el esfuerzo adicional exigido al personal de campo, capture información en el momento en que se produce y la vincule con entidades verificables del proyecto. Los encuentros reforzaron un criterio de diseño: introducir automatización sin exigir el reemplazo inmediato de herramientas y patrones ya incorporados a la rutina. El uso de un canal de mensajería conocido podría disminuir una parte de la barrera inicial, pero no se considera una interacción “sin fricción”: requiere confirmación humana, control de errores, autorización, privacidad y trazabilidad.

El alcance inicial se concentra en dos perfiles: el **profesional independiente** que supervisa directamente una o más obras y la **empresa constructora** con roles diferenciados de dirección, administración y ejecución. Estos perfiles delimitan el segmento a validar y no constituyen, por el momento, una caracterización estadística de todo el sector.

---

## Objetivos

### Objetivo global

Desarrollar un sistema web que permita gestionar y realizar el seguimiento de obras mediante la definición de tareas, la automatización de la comunicación con responsables a través de un chatbot integrado con WhatsApp, la visualización del estado del proyecto mediante paneles y cronogramas, y la captura estructurada de comunicaciones de obra mediante una bitácora que transcriba y procese audios recibidos por WhatsApp. El sistema deberá permitir detectar retrasos, generar alertas y asistir al encargado de obra en la toma de decisiones durante la ejecución del proyecto.

### Objetivos específicos

Los siguientes objetivos corresponden al Anteproyecto aprobado y constituyen la línea base respecto de la cual se evalúa el avance:

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

La tabla presenta el estado técnico verificado al **24 de julio de 2026**. “Implementado” indica que existe un flujo en el prototipo; no implica todavía aceptación por usuarios ni cobertura automatizada completa.

| N.º | Objetivo | Estado al corte | Evidencia disponible | Pendiente de cierre |
|---:|---|---|---|---|
| 1 | Obras, responsables y documentación | Parcial avanzado | Alta y edición de obras; equipo por obra; repositorio de planos versionados. | Precisar si la documentación técnica abarcará otros tipos además de planos y completar las pruebas de autorización. |
| 2 | Tareas e hitos | Implementado; validación pendiente | Tareas, hitos, fechas, avance, subtareas y dependencias persistidas. | Registrar resultados de pruebas funcionales y de casos límite. |
| 3 | Gestión de responsables | Implementado con observaciones | Directorio de responsables, asignación por obra y por tarea. | Completar controles de aislamiento entre empresas y sus pruebas de regresión. |
| 4 | Chatbot y consultas por WhatsApp | Implementado en el prototipo | *Webhook*, identificación por número y flujo estructurado de consulta y respuesta. | Documentar una ejecución reproducible de extremo a extremo y una alternativa de contingencia para la demostración. |
| 5 | Estados automáticos con intervención manual | Implementado como flujo híbrido | Actualización desde el chatbot; edición manual desde la aplicación; sugerencias de IA sujetas a confirmación. | Formalizar la matriz de transiciones y verificar cada origen de cambio. |
| 6 | Alertas | Parcial avanzado | Evaluación de tareas vencidas, sin responsable, bloqueos y porcentaje de vencimiento; notificación en tiempo real. | Verificar específicamente falta de respuesta y vencimientos próximos, y documentar resultados. |
| 7 | Cronograma Gantt | Implementado; validación pendiente | Gantt interactivo, dependencias, hitos, ruta crítica, línea base y reprogramación con vista previa. | Ejecutar pruebas sistemáticas de fechas, dependencias y calendarios. |
| 8 | Panel de estado | Implementado; validación pendiente | Resumen por obra con indicadores de avance, tareas y alertas. | Validar comprensión y utilidad con los perfiles destinatarios. |
| 9 | Historial y trazabilidad | Implementado a nivel de aplicación | Registro de eventos de tareas, alertas, bitácora y cronograma. | Verificar cobertura de todos los eventos y moderar las garantías de inmutabilidad. |
| 10 | Documentación técnica consultable | Parcial | Planos versionados por disciplina y consulta de la última versión mediante WhatsApp. | Definir si el alcance final incluye documentos generales y probar permisos y descarga. |
| 11 | Registro manual de información | Implementado; validación pendiente | Creación de entradas de texto en la bitácora y carga manual de transcripciones. | Confirmar mediante pruebas que ninguna acción sugerida modifica el plan sin aprobación humana. |
| 12 | Bitácora de audio con IA | Implementado en el prototipo | Flujo audio → transcripción → análisis estructurado → revisión de sugerencias. | Evaluar con un corpus documentado, medir resultados y conservar evidencia de ejecución. |

### Evolución del alcance

Durante el desarrollo incremental se incorporaron capacidades que amplían el Anteproyecto aprobado. Algunas fueron conversadas de manera parcial con el equipo docente y el grupo decidió desarrollarlas, pero no reemplazan los doce objetivos originales ni se presentan como compromisos iniciales:

| Ampliación | Relación con el alcance aprobado | Estado |
|---|---|---|
| WBS, cuatro tipos de dependencia, desfases, ruta crítica, línea base, calendario y reprogramación con confirmación | Profundiza los objetivos 2 y 7. | Implementada en el prototipo; requiere mayor cobertura de pruebas. |
| Planilla avanzada e importación desde Excel, CSV y XML exportado por Microsoft Project | Reduce el esfuerzo de carga y facilita la convivencia con herramientas conocidas. | Implementada; su facilidad de uso debe validarse. |
| Presupuestos asistidos por IA, materiales, solicitudes de cotización y órdenes de compra | Constituye una ampliación funcional; el Anteproyecto original excluía la gestión de costos, presupuestos y finanzas. | Implementada parcialmente como flujo adicional y sujeta a validación de alcance y utilidad. |
| Empresas, planes, límites, invitaciones y administración de usuarios | Amplía la arquitectura desde un prototipo de obra hacia un producto multiempresa. | Implementación parcial; persisten controles de autorización por completar. |
| Presencia y actualización en tiempo real | Complementa la coordinación entre usuarios del *backoffice*. | Implementada para un despliegue de una sola instancia; requiere infraestructura compartida para escalar horizontalmente. |
| Recuperación de contraseña, verificación de correo y limitación de intentos de acceso | Fortalece el ciclo de vida de las cuentas y la robustez del sistema. | Implementada en las migraciones y servicios más recientes. |

---

## Marco teórico

### 1. Contexto general del problema

El problema estudiado puede analizarse a partir de cuatro conceptos relacionados: planificación temporal, flujo de información, fragmentación interorganizacional y adopción tecnológica.

**Planificación temporal.** La gestión de proyectos de construcción se apoya en redes de actividades que representan el orden previsto de ejecución. El **método de la ruta crítica (CPM)** permite identificar, dentro de un conjunto de tareas dependientes, la secuencia cuya demora puede modificar la fecha final del proyecto (Kelley & Walker, 1959). Para ello se calculan las fechas tempranas y tardías de inicio y finalización y, a partir de estas, la **holgura** de cada actividad. La representación mediante un **diagrama de Gantt** facilita la lectura de duraciones, solapamientos e hitos sobre una línea de tiempo.

La **estructura de descomposición del trabajo (WBS)** organiza el alcance en componentes jerárquicos; las relaciones Fin–Inicio (FS), Inicio–Inicio (SS), Fin–Fin (FF) e Inicio–Fin (SF), con sus posibles desfases, expresan restricciones temporales; y la **línea base** conserva el cronograma aprobado para compararlo con la ejecución (Project Management Institute, 2021). Sin embargo, estos instrumentos solo conservan capacidad de control si reciben información actualizada y confiable desde el lugar donde se realiza el trabajo.

**Flujo y calidad de la información.** Una obra genera información en múltiples formatos: planos, documentos, fotografías, registros, conversaciones y observaciones directas. El flujo se completa cuando esa información es generada, comunicada, comprendida, registrada y utilizada para decidir. Las categorías propuestas por Xu y Luo (2014) —inconsistencia, deslocalización y ambigüedad— permiten analizar la separación entre el reporte de campo y el cronograma como un problema de continuidad y calidad de la información, y no solamente como una ausencia de software.

**Fragmentación interorganizacional.** Las organizaciones que participan de una obra son temporales, poseen responsabilidades e intereses diferentes y emplean procedimientos heterogéneos. Por esta razón, la disponibilidad de una plataforma no implica necesariamente una práctica colaborativa efectiva (Adriaanse et al., 2010). Tsai (2009) añade que una herramienta destinada al sitio debe integrarse con el trabajo habitual y reducir la carga impuesta al usuario; de lo contrario, puede introducir una barrera adicional.

**Adopción tecnológica.** La adopción debe entenderse como un fenómeno sociotécnico: no depende únicamente de las funciones disponibles, sino también de la motivación, las habilidades, el apoyo organizacional, el valor percibido y las oportunidades concretas de uso. En pequeñas y medianas constructoras, estas variables pueden favorecer implementaciones graduales y beneficios operativos visibles (Lu et al., 2019).

A partir de estos antecedentes, una alternativa orientada a conectar planificación y ejecución debe evaluarse al menos según cinco criterios: **oportunidad de la información, trazabilidad, esfuerzo de uso, integración con los procesos existentes y control humano**. Estos criterios se utilizarán posteriormente para analizar la propuesta, sin presuponer que una tecnología específica resuelve por sí sola el problema.

### 2. Análisis de campo

#### Enfoque y participantes

Como instancia cualitativa exploratoria, durante **junio de 2026** el equipo mantuvo encuentros con **seis informantes clave** vinculados con la dirección, la planificación y la ejecución de obras en Córdoba:

- cuatro arquitectas docentes de la carrera de Arquitectura de la Universidad Católica de Córdoba que, además de su actividad académica, ejercen profesionalmente y dirigen sus propios estudios;
- el director de RODE, empresa constructora de Córdoba; y
- un jefe de obra de esa organización.

Los encuentros con las arquitectas y con el director de RODE se realizaron presencialmente y tuvieron una duración aproximada de entre una y dos horas. Las conversaciones con las docentes aportaron perspectivas provenientes del ejercicio profesional independiente y de estudios de arquitectura. El encuentro con el director permitió realizar una validación cualitativa inicial de la pertinencia de la idea y ampliar la comprensión del horizonte funcional esperado.

Posteriormente, el encuentro con el jefe de obra se realizó mediante Google Meet. La función de pantalla compartida permitió que mostrara su dinámica cotidiana, la relación entre sus herramientas y las aplicaciones utilizadas por la empresa. Esta instancia puede caracterizarse como una demostración guiada del flujo de trabajo y no como una observación directa de la actividad en obra. Su duración no quedó registrada.

El relevamiento constituye una exploración del dominio; no equivale a una validación estadística ni demuestra todavía la adecuación del producto al mercado. RODE se identifica por su nombre como organización participante del relevamiento, no como cliente de CONSTRUCTA.

#### Hallazgos e implicancias para el diseño

La siguiente tabla presenta la información relevada según la reconstrucción realizada por el equipo:

| Evidencia obtenida | Alcance de la evidencia | Implicancia derivada por el equipo |
|---|---|---|
| En el flujo presentado por el jefe de obra de RODE coexisten **Microsoft Project** para la planificación, **Microsoft Excel** para distintos registros y un sistema independiente para pedidos, órdenes de compra y materiales. | Corresponde a una empresa y a un flujo particular; no permite afirmar que todas las constructoras trabajan del mismo modo. | Resulta pertinente conservar convenciones conocidas de planificación y reducir la duplicación de carga entre módulos. |
| El director de RODE consideró pertinente el problema abordado y aportó una perspectiva organizacional sobre el horizonte funcional esperado. | Constituye una validación cualitativa inicial por parte de un informante experto; no demuestra todavía adecuación producto–mercado ni efectividad de la solución. | El alcance debe contemplar tanto la visión de dirección como las necesidades operativas del personal de obra. |
| La síntesis del equipo a partir de los encuentros identifica la incorporación de sistemas diferentes de los ya utilizados como una barrera relevante de adopción. | El hallazgo procede de una reconstrucción retrospectiva sin registro contemporáneo; conviene validarlo posteriormente con los participantes y contrastarlo con una muestra más amplia. | La adopción debe tratarse como requisito del sistema y no únicamente como una etapa posterior de capacitación. |
| La demostración del jefe de obra evidenció el uso de herramientas y patrones ya incorporados a la rutina de esa organización. | No se midieron todavía tiempos, frecuencia de uso ni disposición efectiva al cambio. | La automatización debe introducirse gradualmente, conservar referencias visuales y operativas conocidas y mantener confirmación humana sobre las acciones sugeridas. |

A partir de estos hallazgos, el equipo adoptó como **hipótesis de diseño** que la innovación será más viable si complementa prácticas existentes en lugar de exigir su reemplazo inmediato. Por ello, se procura mantener patrones familiares —como planillas, cronogramas tipo Gantt y canales conversacionales— e incorporar sobre ellos funciones de automatización, integración y trazabilidad. Esta decisión no implica reproducir sin evaluación las herramientas actuales, sino reducir el costo de aprendizaje y facilitar una transición progresiva hacia procesos más integrados.

#### Limitaciones y evidencia pendiente

La muestra fue intencional y reducida, estuvo vinculada con una misma red académica y profesional local y no permite generalizar los resultados al conjunto del sector. Los encuentros no fueron grabados y no se conservaron actas, notas de campo, un cuestionario o una guía de preguntas. Por ello, los hallazgos expuestos corresponden a una reconstrucción retrospectiva del equipo y no deben presentarse como citas textuales ni atribuirse con mayor precisión que la disponible. Tampoco se cuenta todavía con mediciones cuantitativas, pruebas formales de usabilidad ni seguimiento longitudinal.

> **[PENDIENTE]** El equipo no conserva un recuerdo suficientemente detallado para desagregar con rigor lo expresado en cada encuentro. Por ello, no se incorporarán citas ni hallazgos individuales reconstruidos de manera especulativa. La evidencia podrá fortalecerse enviando la síntesis general a los participantes para su validación y registrando las futuras instancias mediante una guía breve, fecha, asistentes, notas y decisiones derivadas.

### 3. Opciones similares en el mercado

El relevamiento documental se concentró en alternativas que representan enfoques diferentes del problema. Microsoft Project de escritorio y Microsoft Planner Premium se consideran por separado: el primero apareció en el relevamiento de RODE y constituye un referente directo de planificación profesional; el segundo representa la oferta colaborativa de planificación en la nube. La comparación se limita a las capacidades publicadas por cada proveedor y a la forma de uso observada; no constituye todavía una evaluación de usabilidad, costos totales ni desempeño en empresas argentinas.

| Alternativa | Capacidades verificadas | Brecha o diferencia respecto del alcance estudiado |
|---|---|---|
| **Planillas y mensajería utilizadas por separado** | Baja barrera inicial, flexibilidad y herramientas conocidas por el equipo. | La relación entre un mensaje, una tarea y una actualización del cronograma depende de criterios y cargas manuales; no existe una única fuente de seguimiento. |
| **Microsoft Project de escritorio** | Diagrama de Gantt, tareas y subtareas, dependencias con adelantos o demoras, programación automática, ruta crítica, líneas base, recursos, costos e informes (Microsoft Support, s. f.). | Es un referente maduro y, en el caso RODE, una herramienta ya incorporada a la planificación. En el flujo observado, Excel y otro sistema completan los registros y la gestión de pedidos, compras y materiales. La documentación consultada no describe captura nativa de novedades mediante WhatsApp. |
| **Microsoft Planner Premium** | Dependencias FS, SS, FF y SF, actualización de fechas, vista de Gantt, ruta crítica, hitos y jerarquía de tareas (Microsoft, s. f.). | Es una alternativa sólida de planificación general. La documentación consultada no describe captura de avances de obra mediante mensajes o audios de WhatsApp. |
| **Procore** | Herramientas específicas de construcción para cronogramas, planos, partes diarios, fotografías, RFIs, submittals y control de costos, con funciones móviles y sin conexión (Procore Technologies, s. f.). | Ya integra oficina y campo; por lo tanto, no corresponde describirla como una herramienta solo administrativa. Su flujo de captura se realiza dentro de la plataforma y la fuente consultada no documenta la interpretación automática de mensajes de WhatsApp para proponer cambios del cronograma. |
| **Autodesk Forma** —antes Autodesk Construction Cloud— | Gestión documental, coordinación de modelos, RFIs, submittals, reportes diarios y conexión entre equipos de campo y oficina (Autodesk, s. f.). | Su alcance integra gestión documental, procesos de construcción y BIM. La diferenciación analizada no radica en que carezca de funciones de campo, sino en el uso de un canal conversacional externo para estructurar reportes y vincularlos con el plan. |
| **WhatsApp Business Platform** | Canal de mensajería bidireccional integrable con sistemas externos, con texto, contenido multimedia, plantillas y webhooks (Meta Platforms, 2026). | Es un canal de comunicación, no un planificador de obra. La asociación de las conversaciones con tareas, dependencias, documentos o alertas requiere un sistema con lógica de dominio. |

El análisis evita dividir el mercado entre “planificadores sin campo” y “herramientas de campo sin estructura”, porque Procore y Autodesk ya conectan ambos entornos. Microsoft Project representa una referencia especialmente relevante por la profundidad de su planificación y por su presencia en el caso relevado. La relación concreta entre estas alternativas y la propuesta desarrollada se analiza en la sección siguiente.

### 4. Tecnologías investigadas

Para documentar la selección tecnológica existente se contrastó cada decisión con alternativas de referencia, considerando adecuación funcional, posibilidad de integración y costo operativo del prototipo. La tabla explicita tanto las ventajas como las restricciones; la adopción de una tecnología no implica que sea universalmente superior a sus alternativas.

| Decisión | Alternativas de referencia | Ventaja para el prototipo | Desventaja o riesgo asumido |
|---|---|---|---|
| **FastAPI y Python** para la API | Frameworks de Node.js/TypeScript y soluciones web síncronas | Validación declarativa de datos, documentación OpenAPI y proximidad con el ecosistema de IA (FastAPI, 2026). | Requiere disciplina en el uso asíncrono y control de operaciones bloqueantes. |
| **PostgreSQL y SQLAlchemy 2.0** para persistencia | Bases documentales y otros ORM | Integridad transaccional y representación explícita de relaciones entre empresas, obras, tareas, dependencias y documentos (PostgreSQL Global Development Group, 2026; SQLAlchemy, 2026). | Los cambios de estructura exigen migraciones y una evolución cuidadosa del modelo. |
| **React, TypeScript y Vite** para la aplicación web | Renderizado del lado del servidor y otros frameworks de interfaz | Componentización, tipado estático y un entorno de desarrollo rápido (React, 2026; TypeScript, 2026). | Una aplicación de página única requiere gestionar explícitamente estado, accesibilidad, tamaño del paquete y navegación. |
| **Socket.IO** para eventos en tiempo real | Sondeo periódico y eventos unidireccionales del servidor | Comunicación bidireccional y actualización inmediata de presencia, alertas y cambios (Socket.IO, 2026). | Aumenta la complejidad operativa; un despliegue con múltiples procesos requiere coordinación de estado mediante infraestructura compartida. |
| **Twilio como intermediario de WhatsApp** | Integración directa con Meta Cloud API | Simplifica la recepción por webhook, el envío de mensajes y el tratamiento de archivos multimedia durante el prototipo (Twilio, 2026). | Introduce dependencia, costo y reglas de un intermediario; deben validarse firmas, plantillas y estados de entrega. |
| **Claude con salida estructurada** para texto y documentos | Extracción manual, reglas determinísticas y respuestas libres de otros LLM | Permite restringir la respuesta a un esquema JSON y procesar texto, PDF e imágenes (Anthropic, 2026). | El resultado continúa siendo probabilístico; existe dependencia externa, costo, tratamiento de datos y necesidad de confirmación humana. |
| **`gpt-4o-mini-transcribe`** para reconocimiento del habla | Transcripción manual, motores locales y otros servicios ASR | Automatiza el primer paso del procesamiento de notas de voz mediante una API especializada (OpenAI, 2026). | La calidad depende del audio y del vocabulario; implica costo, latencia, privacidad y dependencia de conectividad. |
| **Brevo** para correo transaccional | Servidor SMTP propio y otros proveedores | Evita administrar infraestructura de entrega para invitaciones y mensajes de cuenta (Brevo, s. f.). | Requiere credenciales, configuración de dominio y manejo explícito de fallas del proveedor. |

Los mecanismos orientados a eventos se complementan: los **webhooks HTTP** reciben notificaciones de servicios externos, mientras que Socket.IO distribuye cambios hacia los navegadores conectados. Las decisiones implementadas y sus validaciones se desarrollan en la sección de propuesta de solución.

---

## Propuesta de solución

La propuesta de solución consiste en una plataforma web —CONSTRUCTA— compuesta por un backend de servicios, un frontend de página única y un asistente conversacional sobre WhatsApp, integrada con modelos de inteligencia artificial. A continuación se detalla el alcance funcional, el diseño, la implementación y las pruebas.

### Alcance funcional

#### Requerimientos funcionales (qué entra)

- **Gestión de obras:** alta mediante asistente de cuatro pasos (datos, responsables, tareas, confirmación), edición y datos del comitente. El **estado de la obra** (planificada, en progreso, pausada, completada, cancelada) sigue un modelo **híbrido**: transiciona de forma **automática** según el avance de las tareas (pasa a *en progreso* cuando alguna tarea arranca y a *completada* cuando todas se terminan), mientras que las decisiones que no pueden inferirse —*pausar* y *reactivar*— se realizan de forma **manual**; los estados terminales no se modifican a mano.
- **Gestión de tareas:** creación, edición y eliminación; fechas de inicio y fin; porcentaje de avance; hitos; subtareas (WBS); dependencias entre tareas en sus cuatro tipos (Fin–Inicio, Inicio–Inicio, Fin–Fin, Inicio–Fin) con desfase (*lag*).
- **Visualización del cronograma:** diagrama de Gantt con flechas de dependencia, ruta crítica, línea base y reprogramación automática en cascada con vista previa.
- **Planilla de tareas:** edición tipo hoja de cálculo con selección de celdas y rangos, relleno por arrastre (con encadenado de fechas), copiar/pegar de bloques, deshacer e importación desde Excel, CSV y archivos XML exportados por Microsoft Project.
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

- **Seguridad:** la API debe autenticar las operaciones, aplicar permisos por rol y comprobar que cada recurso solicitado pertenece a la empresa del usuario. El prototipo utiliza tokens JWT, contraseñas con *hashing*, URLs firmadas para archivos sensibles y controles por `tenant_id`; la auditoría técnica identificó rutas adicionales cuyo aislamiento debe completarse antes de afirmar una separación estricta.
- **Usabilidad y adopción:** el personal de campo debe poder realizar los reportes principales mediante WhatsApp y la aplicación de escritorio debe conservar patrones conocidos de planilla y cronograma. La reducción efectiva del esfuerzo de aprendizaje deberá medirse mediante pruebas con usuarios.
- **Rendimiento:** las operaciones interactivas deben ofrecer tiempos compatibles con el uso cotidiano. El backend utiliza entrada/salida asíncrona y Socket.IO para determinados eventos, aunque algunos flujos todavía emplean sondeo periódico; faltan umbrales y mediciones reproducibles.
- **Trazabilidad:** los cambios relevantes deben producir eventos vinculados con la obra, la tarea, el actor y el momento. El historial actual funciona como registro de aplicación orientado a anexar eventos, pero no constituye por sí solo un mecanismo criptográfico de inmutabilidad o no repudio.
- **Mantenibilidad:** separación en capas (router → service → repository), esquema de base de datos versionado con migraciones (Alembic) y tipado estático en backend (Python con anotaciones de tipo) y frontend (TypeScript).
- **Disponibilidad y escalabilidad:** el prototipo debe ser desplegable en la nube y recuperarse de fallas controladas. La sesión conversacional se persiste en base de datos, pero la presencia, la limitación de solicitudes y parte de Socket.IO mantienen estado por proceso; el escalado horizontal requerirá infraestructura compartida.
- **Confiabilidad de IA:** ninguna sugerencia generada por un modelo debe modificar el plan sin revisión y confirmación humana; los fallos de transcripción, análisis o conectividad deben quedar visibles y permitir reintento o corrección.
- **Privacidad:** los audios, mensajes y documentos deben ser accesibles únicamente para usuarios autorizados. Deben definirse todavía políticas formales de retención, eliminación, consentimiento y tratamiento por proveedores externos.
- **Costo de operación:** deben registrarse los consumos de mensajería, transcripción y modelos de lenguaje para calcular el costo por operación y por empresa bajo escenarios de uso verificables.

> *(Ejemplo de requerimiento, según la guía)* «El sistema debe permitir que un responsable registre una nota de voz de obra desde WhatsApp y que esta quede asociada a la obra correspondiente con un resumen generado automáticamente.»
>
> **[FIGURA 1: Diagrama de casos de uso de CONSTRUCTA — actores (Administrador, Responsable, Asistente de WhatsApp) y casos de uso principales.]**

#### Relación con Microsoft Project

Por haber sido identificado en el relevamiento de RODE, Microsoft Project se considera tanto una alternativa de mercado como una referencia de interoperabilidad y experiencia de uso:

| Criterio | Microsoft Project de escritorio | CONSTRUCTA |
|---|---|---|
| Orientación | Planificación profesional de propósito general, con un motor de programación y gestión de recursos consolidado. | Gestión de procesos específicamente vinculados con la ejecución y administración de obras. |
| Cronograma | Gantt, jerarquías, dependencias, adelantos y demoras, ruta crítica, múltiples líneas base, recursos y costos. | Gantt, subtareas, cuatro tipos de dependencia, desfases, ruta crítica, línea base y reprogramación en cascada. |
| Información de campo | El cliente de escritorio se concentra en el plan; la colaboración y otros procesos requieren herramientas o servicios complementarios. | Vincula tareas con responsables, alertas, bitácora, planos, presupuestos, materiales y compras. |
| Canal conversacional | La documentación oficial consultada no describe captura de novedades mediante WhatsApp. | Permite reportar estados, registrar audios y consultar documentos mediante un asistente de WhatsApp. |
| Interoperabilidad | Importa y exporta distintos formatos, incluidos Excel, CSV y XML. | Importa Excel, CSV y XML exportado por Microsoft Project y exporta tareas a Excel; no ofrece sincronización bidireccional con Project. |
| Adopción | En el caso RODE es una herramienta conocida e incorporada al trabajo de planificación. | Conserva patrones de Gantt y planilla, pero la reducción efectiva del esfuerzo de aprendizaje aún debe validarse con usuarios. |

CONSTRUCTA no busca replicar por completo a Microsoft Project, sino conservar conceptos conocidos —Gantt, dependencias, responsables, línea base y seguimiento— y sumar integración con procesos cotidianos de obra. Su diferenciación propuesta es recibir texto, audio y archivos mediante un canal conversacional, vincularlos con entidades concretas del proyecto y mantener confirmación y trazabilidad dentro del sistema. La reducción de fricción continúa siendo una **hipótesis de diseño** que deberá medirse mediante pruebas con usuarios.

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
- **Capa de datos:** base de datos relacional PostgreSQL, con esquema versionado mediante migraciones Alembic hasta la versión `0043`.
- **Integraciones externas:** API de WhatsApp (Twilio), modelos de IA (Anthropic Claude y reconocimiento de voz), y correo transaccional (Brevo).

El aislamiento entre empresas se resuelve a nivel de aplicación con un identificador de inquilino (*tenant*) que filtra las consultas de obras, responsables, alertas, usuarios y bitácora.

El sistema opera bajo dos flujos característicos:

1. **Flujo de aplicación web (petición–respuesta):** el navegador realiza llamadas HTTP/JSON a la API; el *router* valida la entrada con un esquema, delega la lógica en el *service*, este accede a los datos por el *repository*, y la respuesta vuelve al cliente. Cuando un cambio debe reflejarse en otros usuarios conectados (una nueva alerta, la presencia de un par, una edición concurrente), el servidor lo emite por Socket.IO sin que el cliente deba volver a consultar.

2. **Flujo de campo (orientado a eventos):** cuando un responsable envía un mensaje de WhatsApp, el proveedor de mensajería invoca el *webhook* del sistema. El servidor identifica al emisor por su número, recupera o crea su sesión de conversación y avanza la máquina de estados del asistente. Las respuestas estructuradas pueden actualizar el estado según reglas predefinidas. Si el mensaje es una nota de voz, se ejecutan la transcripción y el análisis, el resultado se persiste y el equipo recibe una notificación; cualquier cambio sugerido sobre el plan requiere revisión y confirmación humana.

> **[FIGURA 6: Diagrama de arquitectura de tres capas con las integraciones externas.]**

#### Diseño de datos

El modelo de datos, versionado en cuarenta y tres migraciones (`0001` a `0043`), se organiza en torno a la entidad **obra** como agregado central y se compone de las siguientes entidades principales:

- **Identidad y organización:** `tenants` (empresas, con su `plan`), `users` (usuarios con rol y número de WhatsApp), `settings`.
- **Obra y planificación:** `obras` (con datos del comitente), `tasks` (con auto-referencia `parent_task_id` para subtareas y una tabla intermedia de dependencias que registra el tipo —FS/SS/FF/SF— y el desfase), `baselines` (líneas base de tareas), `calendar` (calendario laboral).
- **Equipo:** `responsibles` (directorio de personas) y `obra_team_members` (relación muchos-a-muchos entre responsables y obras, con rol).
- **Comunicación y campo:** `messages` y `conversation_sessions` (estado del asistente de WhatsApp), `bitacora_entries` (notas de voz con su transcripción, resumen y sugerencias), `historial` (registro de eventos *append-only*), `alerts`.
- **Compras y documentación:** `suppliers`, `task_materials`, `purchase_orders` (con sus ítems), `budgets` (presupuestos leídos por IA) y `planos` (documentación versionada).

El aislamiento entre empresas se apoya en la columna `tenant_id` de las entidades de cabecera y de varias tablas hijas críticas, incorporada y reforzada por las migraciones `0040` y `0041`. Las relaciones clave son: una empresa tiene muchos usuarios y muchas obras; una obra tiene muchas tareas, alertas, entradas de bitácora, presupuestos y planos; una tarea pertenece a una obra, puede tener una tarea padre, se relaciona con otras por dependencias y se asigna a un responsable. La auditoría identificó operaciones que aún deben comprobar la pertenencia del recurso, por lo que este diseño no se considera cerrado.

> **[FIGURA 7: Diagrama entidad-relación (DER) del modelo de datos. Referencia: `docs/database.md`.]**

#### Patrones de diseño

- **Capas / separación de responsabilidades:** *router → service → repository* en el backend, aislando la lógica de negocio del acceso a datos.
- **Repositorio (Repository):** abstracción del acceso a datos sobre el ORM.
- **Máquina de estados:** el flujo conversacional del asistente de WhatsApp se modela como una secuencia de pasos con estado persistido (`conversation_sessions`).
- **Registro de eventos:** el historial agrega eventos de obra como registro de aplicación para reconstruir cambios y decisiones. La implementación no incorpora todavía firmas, encadenamiento criptográfico ni restricciones de base de datos que permitan calificarlo como no repudiable.

### Implementación

**Organización del equipo.** El desarrollo es realizado por Martina Becerra, Facundo Graffigna y Agustín Llancaman mediante una modalidad colaborativa, sin una división permanente entre documentación y código. Cada integrante toma actividades según las necesidades del proyecto y su disponibilidad académica, lo que permite compartir el conocimiento de distintas partes de la solución. El equipo mantiene una reunión semanal de seguimiento para revisar avances, dificultades y próximos pasos, y utiliza un grupo de WhatsApp para comunicar de manera asincrónica qué actividad está realizando cada integrante y su estado.

**Dedicación y seguimiento.** La intensidad de trabajo varía entre semanas debido a parciales, exámenes finales y otras obligaciones académicas. En consecuencia, no existe una cantidad semanal uniforme por integrante ni se llevó un registro contemporáneo de horas. Esta flexibilidad permitió redistribuir el esfuerzo, pero limita la estimación precisa del costo de desarrollo y dificulta reconstruir responsabilidades. Para el cierre se propone conservar la reunión semanal y sumar un responsable principal, estado, fecha objetivo y evidencia de aceptación para cada entregable, además de un registro simple de horas por rangos.

**Enfoque de desarrollo.** La construcción se abordó de forma **incremental**, con control de versiones mediante Git. Cada cambio en el modelo de datos se materializó en una migración versionada —cuarenta y tres en el código al 24 de julio de 2026—, de modo que el esquema pudiera evolucionar de manera reproducible. La instancia local auditada permanecía en `0041`, por lo que debe actualizarse a `0043` antes de utilizar las funciones de recuperación de contraseña y verificación de correo. La cronología del desarrollo se documenta en `docs/documentacion.md`.

**Magnitud de la implementación.** Al 24 de julio de 2026, el backend se organiza en veinticinco archivos de rutas, veintidós modelos y dieciséis servicios de negocio. El frontend contiene diez páginas y treinta y cuatro componentes principales. Estas cifras describen la versión auditada y no constituyen por sí mismas una medida de calidad o cumplimiento.

A continuación se describen los módulos que componen la solución:

- **Módulo de autenticación y multi-inquilino:** registro de empresa, inicio de sesión con tokens JWT, recuperación de contraseña, verificación de correo, limitación de intentos de acceso, gestión de roles (administrador / colaborador) e invitaciones por correo. El modelo incorpora `tenant_id` y controles de acceso en los recursos principales, además de planes con límites de obras, usuarios y tareas y respuesta HTTP 402 al superarlos. La auditoría detectó rutas secundarias que aún requieren controles de pertenencia y pruebas de regresión, por lo que el aislamiento se considera parcial.
- **Módulo de obras y tareas:** alta de obra mediante asistente de cuatro pasos y gestión completa de tareas con fechas, porcentaje de avance, hitos, subtareas (WBS, vía `parent_task_id`) y dependencias en sus cuatro tipos (FS, SS, FF, SF) con desfase. Incluye la **reprogramación en cascada**: al modificar las fechas de una tarea con sucesoras, el sistema recorre el grafo de dependencias y ofrece una vista previa de las tareas afectadas antes de confirmar, registrando un único evento en el historial. Además, cuando una fecha de inicio o de fin cae en un día no laboral (fin de semana o feriado del calendario de la obra), el sistema la **ajusta automáticamente al día laboral más cercano** en lugar de rechazar la operación, e informa el ajuste realizado.
- **Módulo de cronograma (Gantt):** visualización interactiva del cronograma con arrastre y redimensionado de barras, vistas de semana, mes y trimestre y **zoom continuo** (gesto de pellizco del *trackpad* o Ctrl+rueda, anclado al punto bajo el cursor) que permite ajustar el nivel de detalle desde una tarea individual hasta la obra completa. Las **subtareas se agrupan inmediatamente debajo de su tarea padre** (jerarquía WBS) y las **dependencias** se hacen explícitas por partida doble: con flechas sobre la línea de tiempo y con una etiqueta en la columna de tareas (que se omite cuando la predecesora es la propia tarea padre, por redundante). Incluye **cálculo de ruta crítica (CPM)** y superposición de la **línea base** para comparar lo planificado con lo replanificado, además de edición y eliminación de tareas desde la propia fila.
- **Módulo de planilla de tareas:** vista de edición tipo hoja de cálculo con selección de celdas y rangos, relleno por arrastre con encadenado automático de fechas, copiar/pegar de bloques y deshacer. La planilla replica la experiencia de una hoja de cálculo real: **zoom continuo** (gesto de pellizco del *trackpad*, anclado al cursor) que revela más o menos celdas, una **grilla que se extiende más allá de los datos** —con desplazamiento hacia celdas vacías como en una hoja de cálculo—, alta de tareas escribiendo directamente sobre cualquier celda vacía e **inserción de filas en cualquier posición del orden** (que se persiste). El usuario puede **mostrar u ocultar columnas** según su necesidad; además de las de planificación, dispone de columnas opcionales de **hito**, **dependencias** y **costo de materiales** (esta última, un resumen que vincula la planilla con el presupuesto de la tarea). Se complementa con **importación** desde Excel, CSV y archivos XML exportados por Microsoft Project (mapeo de WBS, recursos y dependencias) y **exportación** a Excel, además de una plantilla descargable.
- **Módulo de alertas y tiempo real:** un servicio evalúa automáticamente los riesgos de cada obra (tareas vencidas, demoradas o bloqueadas, sin responsable, y alto porcentaje de vencimiento) y genera alertas de distintos tipos —tarea bloqueada, riesgo de demora, tarea vencida, sin respuesta, reprogramación solicitada y recepción de pedido—. Las alertas se emiten en tiempo real por Socket.IO y quedan trazadas en el historial. El mismo canal soporta la presencia de usuarios conectados y la edición colaborativa.
- **Módulo de asistente de WhatsApp:** un *webhook* recibe los mensajes entrantes; el sistema identifica al emisor (responsable de tareas o personal de la empresa) por su número y conduce la conversación mediante una **máquina de estados** (estados: reposo, selección de obra, selección de tarea, menú de estado y espera de fecha), persistida en la base. Permite reportar el estado de una tarea, registrar notas de voz y consultar planos.
- **Módulo de bitácora de obra con IA:** convierte una nota de voz en información estructurada mediante la cadena audio → transcripción con `gpt-4o-mini-transcribe` → análisis con Claude y salida JSON validada. El resultado incluye resumen, puntos clave y sugerencias sobre el plan —reprogramar o crear una tarea, actualizar un estado o registrar una nota— acompañadas por el fragmento que las fundamenta. El jefe puede editar, aceptar o rechazar cada sugerencia; la IA no aplica cambios de manera autónoma. Las entradas sin obra quedan disponibles para asignación manual y el sistema implementa recordatorios temporales al emisor. Desde una tarea puede accederse a los audios que la originaron o modificaron; la navegación inversa completa desde cada nota hacia todas las tareas vinculadas permanece pendiente de cierre. El historial permite buscar y filtrar las entradas.
- **Módulo de presupuestos con IA:** acepta presupuestos de proveedores en múltiples formatos (PDF, imagen, Excel o texto) y, con el mismo modelo de lenguaje, extrae sus datos a una estructura validada (proveedor, fecha, rubro, moneda, ítems con cantidad/unidad/precio/subtotal, IVA, total, flete, plazo de entrega, condiciones de pago y validez). Detecta **inconsistencias** (por ejemplo, totales que no cierran o faltantes de precios) con su severidad, y **compara** varios presupuestos calculando el promedio, el más económico y el desvío porcentual de cada uno.
- **Módulo de planos:** repositorio de documentación con **versionado** por obra y disciplina; marca la última versión vigente y permite su consulta y envío por WhatsApp, evitando que en el campo se trabaje sobre planos desactualizados.
- **Módulo de materiales, presupuesto y compras:** cómputo de materiales por tarea (con unidad, precio unitario y estado de aprovisionamiento), presupuesto por obra (estimado frente a real) y un flujo de **solicitudes de cotización**: desde la obra se seleccionan los materiales pendientes y los proveedores a consultar; el sistema genera un PDF de solicitud y lo envía a cada proveedor por WhatsApp. Cuando el proveedor responde con su presupuesto en PDF —también por WhatsApp—, el sistema lo detecta, lo descarga y delega en el módulo de presupuestos la extracción estructurada con IA. Con dos o más respuestas, se dispara automáticamente un **análisis comparativo** (Claude con salida estructurada JSON Schema) que compara los presupuestos ítem por ítem, identifica ventajas y riesgos de cada proveedor y emite una recomendación fundamentada. Al confirmar el proveedor elegido, se genera la **orden de compra** y los materiales pasan al estado "pedido".

### Pruebas

La verificación disponible combina automatización, compilación, recorridos manuales y auditoría. Se diferencia entre una prueba diseñada, una ejecución exploratoria y una ejecución con resultado formalmente registrado:

| Nivel | Evidencia al 24/07/2026 | Alcance y limitación |
|---|---|---|
| Pruebas automatizadas de backend | **24 pruebas `pytest` aprobadas** en una ejecución local. | Cubren recuperación y verificación de cuenta, limitación de intentos, estado de salud, parte del aislamiento multiempresa, propagación de `tenant_id` y firma de archivos. No cubren todavía la totalidad de los módulos. |
| Frontend | Verificación de tipos y compilación de producción aprobadas mediante `npm run build`. | No existen pruebas unitarias de componentes ni pruebas E2E automatizadas. El paquete principal supera el umbral de tamaño recomendado por Vite. |
| Integración continua | GitHub Actions ejecuta `pytest` y el *build* del frontend en cambios enviados al repositorio. | No ejecuta cobertura, *lint* ni pruebas E2E. |
| Casos manuales | `docs/casos_de_prueba.md` define veinte casos con pasos y resultados esperados. | El archivo no registra fecha, ejecutor, versión, resultado real ni evidencia; por lo tanto, documenta un plan y no un acta de ejecución. |
| Flujos integrados | El equipo ejecutó durante el desarrollo los flujos principales de WhatsApp, bitácora, planos, presupuestos y compras. | Fueron comprobaciones exploratorias y no se conservó evidencia homogénea. Deben repetirse sobre una versión congelada y registrar los resultados. |
| Evaluación académica del MVP | El proyecto fue evaluado por el equipo docente de la asignatura Administración de Proyectos y obtuvo calificación 10. | Constituye una validación académica del avance presentado; no reemplaza pruebas de aceptación con usuarios destinatarios ni una validación de mercado. |
| Auditoría técnica | Ocho análisis por módulo y una consolidación clasifican hallazgos de seguridad, robustez y experiencia de usuario. | La consolidación debe actualizarse: algunos pendientes fueron resueltos y se detectaron rutas adicionales con controles multiempresa incompletos. |

Para cerrar la evidencia antes de la segunda presentación calificada, prevista para el **13 de agosto de 2026**, se deberán repetir, como mínimo, los siguientes recorridos sobre un único *commit* identificado:

| Caso crítico | Resultado que deberá registrarse |
|---|---|
| Alta de obra, tareas y responsables | Datos persistidos y visibles en panel, planilla y Gantt. |
| Consulta y respuesta por WhatsApp | Mensaje recibido, emisor identificado, estado actualizado e historial generado. |
| Bitácora por voz | Audio recibido, transcripción y análisis producidos, sugerencia revisada y acción confirmada. |
| Consulta de plano | Última versión correspondiente enviada al responsable autorizado. |
| Presupuesto y solicitud de cotización | Documento interpretado, comparación generada y orden de compra creada después de la confirmación humana. |
| Aislamiento multiempresa | Recursos de una empresa rechazados para un usuario de otra en todas las rutas críticas. |

Cada ejecución deberá registrar `fecha | commit | entorno | ejecutor | entrada | resultado real | evidencia | incidencia`. La aceptación con arquitectas o personal de obra continúa pendiente.

---

## Beneficios post-implementación

Al no haberse realizado todavía un piloto longitudinal con usuarios, los beneficios se formulan como **resultados esperados** y no como efectos demostrados:

| Beneficio esperado | Indicador propuesto | Método de evaluación |
|---|---|---|
| Menor esfuerzo para informar avances | Tiempo y cantidad de pasos necesarios para reportar una tarea; puntaje de usabilidad percibida. | Comparación de tareas equivalentes mediante el procedimiento actual y mediante WhatsApp. |
| Mayor trazabilidad de la información | Porcentaje de reportes vinculados correctamente con obra, tarea, responsable y fecha. | Auditoría de una muestra de mensajes y audios procesados. |
| Detección más oportuna de desvíos | Tiempo transcurrido entre el reporte de una demora y su visualización como alerta o impacto en el cronograma. | Escenarios controlados con marca temporal. |
| Menor carga manual de registro | Minutos destinados a transcribir, resumir y trasladar novedades al sistema. | Medición antes/después sobre un conjunto común de reportes. |
| Apoyo a la comparación de presupuestos | Tiempo de análisis, porcentaje de campos extraídos correctamente e inconsistencias detectadas. | Comparación contra una revisión manual de referencia. |
| Acceso a documentación vigente | Tiempo para localizar el plano solicitado y porcentaje de respuestas con la versión correcta. | Pruebas por disciplina y por permisos de cada responsable. |

Las líneas base, metas y resultados deberán definirse con los participantes de un piloto. Hasta entonces, no se atribuyen porcentajes de ahorro, adopción o reducción de errores.

---

## Impacto económico (estudio de costos)

> **[PENDIENTE DE TOTAL ACUMULADO]** Se cuantifica el gasto mensual base informado por el equipo. El total histórico deberá completarse con la fecha inicial de cada suscripción, comprobantes, impuestos o cargos de conversión y horas reconstruidas.

**Esfuerzo de implementación.** El equipo no registró horas de manera contemporánea y la dedicación semanal fue variable por parciales y exámenes finales. Por este motivo, no corresponde presentar todavía una cifra única de horas-persona. Para la versión final se realizará una reconstrucción por rangos a partir del historial de Git, las reuniones semanales, los mensajes de coordinación y la estimación individual de cada integrante. Ese esfuerzo deberá valorizarse con una fuente explícita para el valor hora y acompañarse con escenarios mínimo, probable y máximo.

**Gastos directos informados durante el desarrollo.**

| Concepto | Situación actual | Tratamiento en el cálculo |
|---|---|---|
| Suscripción a Claude | Tres cuentas individuales a USD 20 mensuales cada una. | **USD 60 por mes** para el equipo. Falta confirmar desde qué mes se abona y qué proporción corresponde imputar al proyecto. |
| Suscripción a ChatGPT | Tres cuentas individuales a USD 20 mensuales cada una. | **USD 60 por mes** para el equipo. Falta confirmar desde qué mes se abona y qué proporción corresponde imputar al proyecto. |
| Twilio / WhatsApp | Se utiliza la modalidad gratuita o de prueba durante el desarrollo. | No se informó desembolso monetario hasta el corte; deben registrarse créditos, límites y costo proyectado para un piloto o producción. |
| Alojamiento | Backend, frontend y base de datos se ejecutan localmente. | No existe gasto directo de *hosting* informado hasta el corte; no se incluyen todavía equipo personal, conectividad ni electricidad. |

El gasto bruto base informado por suscripciones es, por lo tanto, de **USD 120 mensuales para el equipo** (`3 × USD 20 de Claude + 3 × USD 20 de ChatGPT`). La cifra no incluye impuestos, recargos ni diferencias de cambio. El costo acumulado se obtendrá como `USD 120 × cantidad de meses abonados`, antes de definir la proporción atribuible específicamente a CONSTRUCTA.

Las suscripciones personales utilizadas para asistir el desarrollo deben diferenciarse de los costos variables generados por la aplicación al consumir APIs externas. Ambos conceptos pueden ser válidos para el estudio, pero responden a unidades y beneficiarios distintos.

**Costos futuros de operación por empresa cliente.**

| Concepto | Unidad que deberá medirse | Estado |
|---|---|---|
| Hosting backend y base de datos | USD por mes según recursos, almacenamiento y copias de seguridad. | Pendiente de seleccionar proveedor y realizar una prueba desplegada. |
| Hosting frontend | USD por mes y transferencia. | Pendiente; podría utilizar inicialmente un plan sin cargo, sujeto a sus límites. |
| Mensajería WhatsApp | Conversaciones, mensajes o plantillas cobrables según el proveedor elegido. | Pendiente de estimar con escenarios de cantidad de obras y responsables. |
| Modelos de IA | Minutos de audio, tokens, páginas o documentos procesados. | Pendiente de medir por operación y por escenario mensual. |
| Correo transaccional | Mensajes enviados y límites del plan. | Pendiente de medir para invitaciones, recuperación y verificación. |

Durante el desarrollo se registró como observación preliminar un costo cercano a USD 0,01 para procesar un audio de aproximadamente dos minutos. No se conserva todavía la factura, el consumo de tokens ni el cálculo reproducible que permita utilizar esa cifra como resultado verificado. Antes de la entrega final deberá repetirse la medición, indicando fecha, modelos, precios vigentes, duración del audio, unidades consumidas y fórmula.

**Ahorros potenciales para el cliente.** El principal ahorro es el **tiempo de coordinación** que hoy se pierde en transcribir avances, perseguir respuestas y reconstruir lo acordado, además del costo evitado por **demoras detectadas tarde**.

**Modelo de ingresos.** El código contempla planes por suscripción (Básico, Pro y Enterprise) con límites de obras, usuarios y tareas. Los nombres, precios y límites actuales son parámetros de prototipo y no constituyen todavía una estrategia comercial validada.

> El presente apartado debe completarse con un estudio serio y específico: reconstrucción por rangos del esfuerzo, comprobantes de suscripciones, precios de API diferenciados de planes personales, infraestructura elegida, tres escenarios de uso y una proyección de retorno de inversión, conforme a la exigencia de la cátedra.

---

## Impacto social

- **Contribución potencial:** un registro más trazable puede reducir ambigüedades y facilitar la coordinación entre empresa, profesionales, contratistas y comitente. Este efecto deberá comprobarse en uso real.
- **Población destinataria:** profesionales independientes y empresas constructoras pequeñas o medianas que necesiten conectar planificación, seguimiento y documentación.
- **Accesibilidad de adopción:** utilizar un canal conocido puede disminuir el aprendizaje inicial, pero no elimina la necesidad de conectividad, dispositivo, alfabetización digital, asistencia y capacitación.
- **Riesgos y salvaguardas:** el procesamiento de mensajes, audios y documentos puede afectar la privacidad y generar percepción de vigilancia laboral. La solución debe informar su finalidad, limitar accesos y conservación, obtener las autorizaciones necesarias y mantener revisión humana ante resultados producidos por IA.

No se atribuye todavía reducción de conflictos, inclusión digital ni mejora de bienestar, porque no fueron medidos mediante un piloto.

---

## Impacto medioambiental (opcional)

- **Efectos potencialmente favorables:** la consulta digital de planos y registros puede disminuir ciertas impresiones; una coordinación más oportuna podría evitar parte del retrabajo; y el registro de materiales permitiría construir indicadores futuros de consumo.
- **Contrapartidas:** el alojamiento, la transferencia de archivos y el procesamiento mediante modelos de IA también consumen energía y recursos de infraestructura.
- **Estado de evaluación:** no se midieron consumo de papel, materiales evitados, emisiones ni energía digital. Por ello, no puede afirmarse todavía un impacto ambiental neto positivo.

---

## Conclusión

Al corte documentado, CONSTRUCTA constituye un prototipo funcional que integra gestión de obras, tareas y responsables; panel y cronograma; comunicación estructurada por WhatsApp; alertas e historial; consulta de planos; y una bitácora de voz asistida por inteligencia artificial. Estas capacidades aportan implementación concreta a los doce objetivos del Anteproyecto, aunque su grado de cierre no es uniforme: la documentación técnica general, determinadas condiciones de alertas, los controles multiempresa y la evidencia formal de pruebas permanecen parciales.

El hito de MVP fue evaluado por docentes de la asignatura Administración de Proyectos y obtuvo calificación 10. Esta instancia respalda la calidad académica del avance presentado, pero se diferencia de una prueba de aceptación con usuarios finales. Los encuentros con profesionales y con RODE validaron cualitativamente la pertinencia del problema y orientaron decisiones de diseño; la utilidad y la adopción de la solución deberán comprobarse mediante un piloto.

Durante el desarrollo se agregaron funciones no comprometidas originalmente —planificación avanzada, importaciones, presupuestos, cotizaciones, compras y administración multiempresa—. Estas ampliaciones demuestran capacidad de evolución, pero deben evaluarse por separado para evitar que oculten el cumplimiento del núcleo aprobado.

Los principales pendientes son repetir y documentar los recorridos críticos sobre una versión congelada; completar los controles de autorización; ampliar las pruebas automatizadas hacia frontend e integraciones; actualizar los diagramas y el estudio económico; y realizar pruebas de usabilidad y aceptación. El desarrollo también mostró que la familiaridad de una interfaz no garantiza adopción, que las salidas estructuradas de IA requieren validación y control humano, y que una funcionalidad implementada solo puede declararse cerrada cuando existe evidencia reproducible.

**Reflexión sobre la organización.** La modalidad compartida permitió que los tres integrantes participaran tanto en código como en documentación y que la carga pudiera redistribuirse durante semanas con evaluaciones académicas. La reunión semanal y la comunicación por WhatsApp sostuvieron la coordinación aun cuando la disponibilidad individual no fue uniforme.

La principal limitación metodológica fue no registrar desde el comienzo horas, responsables primarios, decisiones y evidencia de cierre con una estructura homogénea. En una nueva iteración se mantendría la propiedad colectiva del producto, pero cada entregable tendría un responsable principal, un revisor, una fecha y un criterio verificable de aceptación. También se incorporaría un registro liviano de esfuerzo y resultados de pruebas para mejorar la estimación, la trazabilidad y el estudio económico.

> **[PENDIENTE]** Agregar, si el equipo logra reconstruirlas, una síntesis de las principales dificultades técnicas y de las decisiones que más aprendizaje produjeron.

---

## Bibliografía / Referencias

> Listado en formato APA v7. Se priorizan fuentes académicas del dominio y documentación oficial. En la versión final de Google Docs deberá verificarse, mediante la herramienta de citas, la correspondencia entre cada cita del texto y esta lista.

- Adriaanse, A., Voordijk, H., & Dewulf, G. (2010). Adoption and use of interorganizational ICT in a construction project. *Journal of Construction Engineering and Management, 136*(9), 1003–1014. https://doi.org/10.1061/(ASCE)CO.1943-7862.0000201
- Alembic. (2026). *Alembic documentation*. https://alembic.sqlalchemy.org
- Anthropic. (2026). *Claude API documentation*. Anthropic. https://docs.anthropic.com
- Autodesk. (s. f.). *Construction management software*. Recuperado el 24 de julio de 2026, de https://construction.autodesk.com/
- Brevo. (s. f.). *Send a transactional email*. Recuperado el 24 de julio de 2026, de https://developers.brevo.com/docs/send-a-transactional-email
- Cámara Argentina de la Construcción. (2018). *Gestión y productividad de obra*. Escuela de Gestión de la Construcción. https://biblioteca.camarco.org.ar/libro/gestion-y-productividad-de-obra/
- FastAPI. (2026). *FastAPI documentation*. https://fastapi.tiangolo.com
- Kelley, J. E., & Walker, M. R. (1959). Critical-path planning and scheduling. *Proceedings of the Eastern Joint Computer Conference*, 160–173.
- Lu, H., Pishdad-Bozorgi, P., Wang, G., Xue, Y., & Tan, D. (2019). ICT implementation of small- and medium-sized construction enterprises: Organizational characteristics, driving forces, and value perceptions. *Sustainability, 11*(12), 3441. https://doi.org/10.3390/su11123441
- McKinsey Global Institute. (2017). *Reinventing construction: A route to higher productivity*. McKinsey & Company. https://www.mckinsey.com/capabilities/operations/our-insights/reinventing-construction-through-a-productivity-revolution
- Meta Platforms. (2026). *WhatsApp Business Platform documentation*. https://developers.facebook.com/docs/whatsapp
- Microsoft. (s. f.). *Advanced capabilities with premium plans in Planner*. Recuperado el 24 de julio de 2026, de https://support.microsoft.com/en-US/Planner/teams/advanced-capabilities-with-premium-plans-in-planner
- Microsoft Support. (s. f.). *Project help*. Recuperado el 24 de julio de 2026, de https://support.microsoft.com/en-us/project/project-help
- OpenAI. (2026). *Speech-to-text (audio transcription) documentation*. https://platform.openai.com/docs/guides/speech-to-text
- PostgreSQL Global Development Group. (2026). *PostgreSQL documentation*. https://www.postgresql.org/docs/
- Procore Technologies. (s. f.). *Construction project management software*. Recuperado el 24 de julio de 2026, de https://www.procore.com/project-management
- Project Management Institute. (2021). *A guide to the project management body of knowledge (PMBOK guide)* (7th ed.). PMI.
- React. (2026). *React documentation*. Meta. https://react.dev
- Socket.IO. (2026). *Socket.IO documentation*. https://socket.io/docs/
- SQLAlchemy. (2026). *SQLAlchemy 2.0 documentation*. https://docs.sqlalchemy.org
- Tsai, M.-K. (2009). Improving communication barriers for on-site information flow: An exploratory study. *Advanced Engineering Informatics, 23*(3), 323–331. https://doi.org/10.1016/j.aei.2009.03.002
- Twilio. (2026). *Twilio API for WhatsApp documentation*. https://www.twilio.com/docs/whatsapp
- TypeScript. (2026). *TypeScript documentation*. Microsoft. https://www.typescriptlang.org/docs/
- Xu, S., & Luo, H. (2014). The information-related time loss on construction sites: A case study on two sites. *International Journal of Advanced Robotic Systems, 11*(8), Article 128. https://doi.org/10.5772/58444

---

## Anexos

Información suplementaria, no necesaria para el entendimiento mínimo del proyecto:

- **Anexo A — Bitácora de desarrollo completa:** `docs/documentacion.md` (registro cronológico de avances, decisiones y validaciones).
- **Anexo B — Esquema de base de datos:** `docs/database.md` y diagrama entidad–relación. **[PENDIENTE]** Actualizarlos desde las migraciones `0001`–`0043`.
- **Anexo C — Casos de prueba manuales:** `docs/casos_de_prueba.md`.
- **Anexo D — Auditorías de la aplicación:** `docs/auditoria-general.md`, `docs/auditoria-ux.md`, `docs/auditoria-flujo-alta.md`, los ocho análisis por módulo y `docs/auditoria-sistema-consolidada.md`.
- **Anexo E — Repositorio de código:** https://github.com/facugraffigna466/CONSTRUCTA
- **Anexo F — Relevamiento de campo:** matriz retrospectiva de encuentros y validación posterior de sus participantes. **[PENDIENTE]**
- **Anexo G — Resultados de pruebas:** acta de ejecución con fecha, *commit*, entorno, resultado y evidencia. **[PENDIENTE]**
- **Anexo H — Cálculo económico:** horas, valores, consumos, escenarios y fórmulas utilizados. **[PENDIENTE]**
