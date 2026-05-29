# Casos de Prueba — CONSTRUCTA

> Versión 1.0 · Mayo 2026  
> Entorno: `http://localhost:5173` (frontend) · `http://localhost:8000` (backend)

---

## CP-01 · Login exitoso

**Área:** Autenticación  
**Prioridad:** Alta

**Precondiciones:**
- Usuario registrado con email `admin@constructa.com` y contraseña conocida
- Backend corriendo

**Pasos:**
1. Navegar a `http://localhost:5173`
2. Ingresar email y contraseña válidos
3. Hacer clic en "Iniciar sesión"

**Resultado esperado:**
- Se redirige al Panel principal
- Se muestra el nombre del usuario en la barra lateral inferior
- El token JWT queda guardado en `localStorage`

---

## CP-02 · Login con credenciales incorrectas

**Área:** Autenticación  
**Prioridad:** Alta

**Precondiciones:**
- Backend corriendo

**Pasos:**
1. Navegar a `http://localhost:5173`
2. Ingresar un email válido con contraseña incorrecta
3. Hacer clic en "Iniciar sesión"

**Resultado esperado:**
- No se redirige al panel
- Se muestra mensaje de error (credenciales inválidas)
- No se guarda token en `localStorage`

---

## CP-03 · Presencia de usuarios online

**Área:** Presencia en tiempo real  
**Prioridad:** Alta

**Precondiciones:**
- Dos cuentas de usuario activas (una admin, una colaborador)
- Ambos navegadores abiertos y sesión iniciada

**Pasos:**
1. Abrir la app con el Usuario A (navegación normal)
2. Abrir la app con el Usuario B en navegación privada
3. Esperar hasta 10 segundos

**Resultado esperado:**
- En el header de Usuario A aparece el avatar del Usuario B
- En el header de Usuario B aparece el avatar del Usuario A
- Al hacer hover sobre el avatar aparece la pill con nombre y punto verde "En línea ahora"

---

## CP-04 · Crear obra nueva

**Área:** Gestión de obras  
**Prioridad:** Alta

**Precondiciones:**
- Sesión iniciada con rol **Administrador**

**Pasos:**
1. Hacer clic en "+ Nueva obra" en el portfolio
2. Completar nombre, ubicación y estado
3. Confirmar creación

**Resultado esperado:**
- La obra aparece en la grilla del portfolio
- El contador "Total obras" incrementa en 1
- Se puede seleccionar la obra y ver su detalle

---

## CP-05 · Colaborador no puede crear obra

**Área:** Control de permisos por rol  
**Prioridad:** Alta

**Precondiciones:**
- Sesión iniciada con rol **Colaborador**

**Pasos:**
1. Navegar al Portfolio

**Resultado esperado:**
- El botón "+ Nueva obra" **no aparece** en la interfaz
- No existe forma de acceder al wizard de creación

---

## CP-06 · Crear tarea en una obra

**Área:** Gestión de tareas  
**Prioridad:** Alta

**Precondiciones:**
- Sesión iniciada con rol Administrador
- Al menos una obra existente

**Pasos:**
1. Abrir una obra → pestaña **Tareas**
2. Hacer clic en "+ Nueva tarea"
3. Completar título, fechas y responsable
4. Guardar

**Resultado esperado:**
- La tarea aparece en la lista con estado "Pendiente"
- Los contadores de la obra se actualizan
- Si hay otro usuario viendo la misma obra, recibe la tarea en tiempo real vía socket

---

## CP-07 · Actualizar estado de una tarea

**Área:** Gestión de tareas  
**Prioridad:** Alta

**Precondiciones:**
- Al menos una tarea existente en una obra

**Pasos:**
1. Abrir la obra → pestaña Tareas
2. Cambiar el estado de una tarea (ej: Pendiente → En progreso)
3. Guardar cambios

**Resultado esperado:**
- El estado de la tarea se actualiza en la tabla
- El contador de "Tareas activas" en ResumenTab refleja el cambio
- La barra de progreso del Avance general se recalcula

---

## CP-08 · Invitar miembro al workspace

**Área:** Gestión de equipo  
**Prioridad:** Media

**Precondiciones:**
- Sesión iniciada con rol **Administrador**
- Credenciales SMTP configuradas en `.env`

**Pasos:**
1. Ir a "Gestión de equipo"
2. Hacer clic en "Invitar miembro"
3. Ingresar el email de la persona a invitar
4. Confirmar

**Resultado esperado:**
- Se muestra confirmación de envío
- El destinatario recibe un email con el link `/invite/{token}`
- Al abrir el link, puede completar el registro y acceder al workspace

---

## CP-09 · Sincronización en tiempo real entre dos usuarios

**Área:** Socket.IO — eventos de tareas  
**Prioridad:** Alta

**Precondiciones:**
- Dos sesiones abiertas en la misma obra (navegación normal + privada)

**Pasos:**
1. Usuario A crea una nueva tarea desde su sesión
2. Observar la pantalla del Usuario B sin recargar

**Resultado esperado:**
- La tarea creada por A aparece en la lista de B en menos de 2 segundos
- Aparece un toast de actividad indicando quién creó qué
- No se requiere recargar la página

---

## CP-10 · Logout y limpieza de sesión

**Área:** Autenticación  
**Prioridad:** Alta

**Precondiciones:**
- Sesión activa

**Pasos:**
1. Hacer clic en el avatar del usuario (esquina inferior izquierda o header)
2. Seleccionar "Cerrar sesión"

**Resultado esperado:**
- Se redirige a la pantalla de login
- El token JWT es eliminado de `localStorage`
- Al intentar volver atrás en el navegador, la app redirige al login (no se puede acceder sin autenticar)
- El avatar del usuario desaparece del header de otros usuarios dentro de los próximos 90 segundos

---

---

## CP-11 · Filtrar obras por estado

**Área:** Portfolio  
**Prioridad:** Media

**Precondiciones:**
- Al menos 2 obras con distintos estados (ej: una Planificada, una En progreso)

**Pasos:**
1. Estar en la pantalla del Portfolio
2. Hacer clic en el filtro "Planificadas"

**Resultado esperado:**
- Solo se muestran las obras con estado Planificada
- El contador del filtro coincide con las obras visibles
- Al volver a "Todas" se muestran todas nuevamente

---

## CP-12 · Fijar y desfijar una obra

**Área:** Portfolio  
**Prioridad:** Baja

**Precondiciones:**
- Al menos una obra existente

**Pasos:**
1. En la grilla del portfolio, hacer clic en el ícono de pin de una obra
2. Verificar la sección "Fijadas" en la barra lateral
3. Volver a hacer clic en el pin para desfijar

**Resultado esperado:**
- Al fijar: la obra aparece en la sección "FIJADAS" del sidebar
- Al desfijar: desaparece de esa sección
- El estado persiste al recargar la página (guardado en `localStorage`)

---

## CP-13 · Eliminar una tarea

**Área:** Gestión de tareas  
**Prioridad:** Alta

**Precondiciones:**
- Sesión con rol Administrador
- Al menos una tarea existente en una obra

**Pasos:**
1. Abrir la obra → pestaña Tareas
2. Hacer clic en el menú de opciones de una tarea
3. Seleccionar "Eliminar"
4. Confirmar en el diálogo

**Resultado esperado:**
- La tarea desaparece de la lista
- El contador de tareas de la obra disminuye en 1
- El otro usuario que esté viendo la obra recibe el evento de eliminación en tiempo real

---

## CP-14 · Ver cronograma Gantt de una obra

**Área:** Cronograma  
**Prioridad:** Media

**Precondiciones:**
- Al menos una tarea con fechas definidas

**Pasos:**
1. Abrir una obra → pestaña **Resumen**
2. Observar la sección "Cronograma de tareas"
3. Cambiar la vista entre Semana / Mes / Trim.

**Resultado esperado:**
- Las tareas con fechas aparecen como barras en el Gantt
- La línea vertical roja marca el día actual
- Al cambiar vista, el cronograma se reescala correctamente

---

## CP-15 · Marcar alerta como leída

**Área:** Alertas  
**Prioridad:** Media

**Precondiciones:**
- Al menos una alerta no leída en la obra

**Pasos:**
1. Abrir una obra → pestaña **Alertas**
2. Hacer clic en "Marcar como leída" en una alerta

**Resultado esperado:**
- La alerta cambia visualmente a estado leída
- El contador de alertas no leídas en el ícono de campana disminuye
- El KPI "Alertas activas" en ResumenTab se actualiza

---

## CP-16 · Agregar responsable a una obra

**Área:** Responsables  
**Prioridad:** Media

**Precondiciones:**
- Sesión con rol Administrador
- Al menos un miembro en el workspace

**Pasos:**
1. Abrir una obra → pestaña **Responsables**
2. Hacer clic en "Agregar responsable"
3. Seleccionar un miembro y confirmar

**Resultado esperado:**
- El responsable aparece en la lista de la obra
- El contador de responsables en la cabecera de la obra se actualiza
- El responsable puede ser asignado a tareas de esa obra

---

## CP-17 · Tarea sin fecha aparece en sección "Sin fechas"

**Área:** Gestión de tareas  
**Prioridad:** Media

**Precondiciones:**
- Una obra abierta

**Pasos:**
1. Crear una tarea sin completar los campos de fecha inicio ni fecha fin
2. Ir a la pestaña Resumen

**Resultado esperado:**
- La tarea aparece en la sección "Tareas sin fechas" del ResumenTab
- El badge naranja "X sin fecha" del cronograma incrementa
- La tarea **no** aparece en el Gantt

---

## CP-18 · Cambiar contraseña

**Área:** Perfil de usuario  
**Prioridad:** Media

**Precondiciones:**
- Sesión activa

**Pasos:**
1. Hacer clic en el avatar propio → "Mi perfil" o "Configuración"
2. Ir a cambio de contraseña
3. Ingresar contraseña actual y la nueva dos veces
4. Confirmar

**Resultado esperado:**
- Se muestra confirmación de éxito
- Al cerrar sesión e intentar login con la contraseña anterior, el acceso es denegado
- Con la contraseña nueva el login funciona correctamente

---

## CP-19 · Navegación entre pestañas de obra sin perder datos

**Área:** Obra — navegación  
**Prioridad:** Baja

**Precondiciones:**
- Una obra con tareas, alertas y responsables cargados

**Pasos:**
1. Abrir una obra en la pestaña **Resumen**
2. Cambiar a pestaña **Tareas**
3. Cambiar a **Alertas**
4. Volver a **Resumen**

**Resultado esperado:**
- Cada pestaña carga su contenido sin errores
- Al volver a Resumen los KPIs siguen mostrando los valores correctos
- No hay errores en consola del navegador

---

## CP-20 · Acceso directo por URL sin sesión

**Área:** Seguridad  
**Prioridad:** Alta

**Precondiciones:**
- No hay sesión activa (token eliminado)

**Pasos:**
1. Intentar acceder directamente a `http://localhost:5173` sin haber iniciado sesión

**Resultado esperado:**
- La app redirige automáticamente a la pantalla de login
- No se muestra ningún dato de la aplicación
- Las llamadas a la API retornan 401 si se hacen manualmente sin token

---

## Matriz de cobertura

| ID | Área | Prioridad | Tipo |
|----|------|-----------|------|
| CP-01 | Autenticación | Alta | Funcional positivo |
| CP-02 | Autenticación | Alta | Funcional negativo |
| CP-03 | Presencia | Alta | Integración |
| CP-04 | Obras | Alta | Funcional positivo |
| CP-05 | Permisos | Alta | Control de acceso |
| CP-06 | Tareas | Alta | Funcional positivo |
| CP-07 | Tareas | Alta | Funcional positivo |
| CP-08 | Equipo | Media | Funcional positivo |
| CP-09 | Tiempo real | Alta | Integración |
| CP-10 | Autenticación | Alta | Funcional + Seguridad |
| CP-11 | Portfolio | Media | Funcional positivo |
| CP-12 | Portfolio | Baja | Persistencia |
| CP-13 | Tareas | Alta | Funcional positivo |
| CP-14 | Cronograma | Media | Funcional positivo |
| CP-15 | Alertas | Media | Funcional positivo |
| CP-16 | Responsables | Media | Funcional positivo |
| CP-17 | Tareas | Media | Funcional negativo |
| CP-18 | Perfil | Media | Funcional positivo |
| CP-19 | Navegación | Baja | Regresión |
| CP-20 | Seguridad | Alta | Control de acceso |
