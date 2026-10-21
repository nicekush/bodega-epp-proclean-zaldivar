# Guías de Despacho v2

## Activación

El código necesita la migración `scratch/upgrade_guias_despacho_v2.sql`, que se ejecuta completa en el editor SQL del proyecto Supabase. La migración conserva los registros, catálogos y parámetros existentes; no importa guías históricas ni crea ejemplos. Se puede volver a ejecutar sin reiniciar el contador de folios.

1. Abrir el editor SQL de Supabase, pegar el contenido completo del archivo y ejecutarlo.
2. Confirmar la versión con `select public.guias_modulo_version();`, cuyo resultado debe ser `2`.
3. Recargar la aplicación actualizada. Si la sesión anterior no dispone de autorización para guías, confirmar la misma clave de la aplicación al realizar la primera operación.

Hasta aplicar la migración, la interfaz mantiene la consulta y exportación disponibles y deshabilita las operaciones. No sustituye un error de servidor por un guardado local ficticio.

Para una instalación nueva, ejecutar primero `scratch/setup_guias_despacho.sql` y después la migración v2. En el proyecto actual las tablas ya existen: solo hace falta la migración v2.

## Funciones implementadas

- Búsqueda por folio exacto con `#`, palabras sin tildes, patente, chofer, destino, vehículo, emisor, receptor, observaciones y artículos.
- Filtros combinados de estado, fechas inclusivas, destino, chofer y vehículo. Las opciones relacionadas muestran la cantidad de guías coincidentes y conservan una selección aunque pase a tener cero resultados.
- Indicadores sobre la selección filtrada, antigüedad del pendiente más antiguo y tiempo medio entre inicio de ruta y recepción, cuando existen ambos registros.
- Paginación corregida al reducirse el conjunto y consultas paginadas al servidor para cargar el historial completo disponible.
- Creación y edición con cantidades positivas, descripciones y unidades válidas, observaciones por artículo y conservación de caracteres especiales.
- Folio asignado en servidor al emitir. El contador no depende del navegador ni reutiliza folios eliminados.
- Guardado transaccional de guía, artículos y auditoría. Un fallo revierte toda la operación y deja el formulario abierto.
- Identificador de emisión estable mientras se reintenta el mismo formulario. Un reintento recupera el resultado confirmado sin duplicarlo.
- Bloqueo de doble envío durante una operación y control de actualización concurrente mediante la revisión de la guía que abrió el formulario.
- Edición de carga y datos solo mientras la guía está por despachar. Folio y estado no se editan como campos de formulario.
- Acciones separadas para iniciar ruta, registrar recepción con firma, anular con motivo y eliminar una guía por despachar.
- Historial por guía con usuario verificado, fecha, detalles y comparación de valores/carga antes y después. Los eventos no pueden actualizarse o borrarse por los clientes del módulo.
- Configuración persistida de empresa/emisor y administración de catálogos, utilizada en las próximas guías y sin reescribir las ya emitidas.
- CSV con una fila por artículo, cantidades numéricas, recepción, seguimiento, filtros y fecha de exportación. No exporta todas las guías cuando una búsqueda tiene cero coincidencias.
- Vista previa sin generar eventos de impresión. La acción de imprimir registra una solicitud de impresión, sin atribuir al navegador confirmación de una impresión física.
- Impresión con estado de la guía y firma registrada, sin superponer el vale de entrega. Ajustes de contraste, filtros y formularios en móvil.

## Estados y permisos

| Acción | Estado permitido | Usuario |
| --- | --- | --- |
| Crear | Nueva guía por despachar | Usuario validado |
| Editar datos/carga | Por despachar | Usuario validado |
| Iniciar ruta | Por despachar → En ruta | Usuario validado |
| Registrar recepción | En ruta → Entregada | Usuario validado; receptor y firma requeridos |
| Anular | Por despachar / En ruta → Anulada | Supervisor o Administrador; motivo requerido |
| Eliminar | Por despachar | Supervisor o Administrador; conserva evento y no reutiliza folio |
| Configurar empresa y catálogos | No aplica | Supervisor o Administrador |
| Consultar historial / solicitar impresión | Guía existente | Usuario validado |

La validación y los permisos se aplican en el servidor. Las guías entregadas o anuladas no admiten cambios de carga ni reapertura desde este módulo.

## Sesiones y alcance de seguridad

Las sesiones del módulo se emiten al validar las credenciales mediante la función existente `verificar_credenciales`. La clave no se almacena en el navegador ni en las nuevas tablas. El navegador conserva un token temporal en `sessionStorage`; la base almacena su hash, consulta el rol vigente y aplica una caducidad de ocho horas. Cerrar la sesión de la aplicación también descarta/revoca el token de guías.

La migración retira la escritura directa sobre las tablas del módulo a los roles de API y canaliza las mutaciones por funciones transaccionales. La auditoría se consulta con sesión y su contenido no incluye imágenes de firma duplicadas en los cambios antes/después.

La autenticación y administración global de usuarios de la aplicación siguen utilizando sus funciones existentes. Esta entrega no migra todos los módulos a Supabase Auth ni modifica los permisos o RPC de gestión de usuarios fuera de Guías de Despacho; ese alcance requiere una revisión global independiente.

## Alcance de bodega

Las guías continúan registrando carga de texto libre. No generan descuentos automáticos de inventario: antes de introducirlos debe definirse qué tipos de guía representan una salida de EPP, un traslado de equipos u otra carga, y cómo evitar descontar dos veces un movimiento ya registrado.

## Verificación

- `npm test`: modelo de búsqueda/exportación, caché, repositorio y migración real en una instancia PostgreSQL aislada mediante PGlite. Incluye fallos inducidos de carga y auditoría, reintentos, estados, permisos, revisiones concurrentes y folios.
- `npm run test:e2e`: interfaz completa en Chrome/Chromium con una API de prueba conectada exclusivamente al PostgreSQL aislado. La URL de Supabase es ficticia; no utiliza registros de producción.
- `npm run build`: compilación de producción.

Las pruebas de navegador requieren Chrome/Edge instalado o los navegadores de Playwright. También se puede definir `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
