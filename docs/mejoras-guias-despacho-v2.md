# Guías de Despacho (operaciones v2, sesión v3, transporte v4 y encabezado v5)

## Activación

Para configurar la descripción bajo la razón social, ejecutar `scratch/upgrade_guias_despacho_v5.sql` después de v4. La versión pasa a ser `5`. El campo **Descripción bajo la razón social (opcional)** está en Guías → Configuración → Empresa emisora. Vacío oculta la línea; no existe un texto predeterminado. Es una opción de la plantilla que se aplica al imprimir cualquier guía, incluso una ya emitida, sin modificar los datos registrados de esa guía.

Para permitir vehículo y conductor en blanco, ejecutar `scratch/upgrade_guias_despacho_v4.sql` después de v3 y recargar la aplicación. El resultado de `select public.guias_modulo_version();` pasa a ser `4`. La migración conserva datos y validaciones de destino/carga. Se puede reaplicar; acepta también el formato SQL con saltos de línea copiado del chat. Con v3 aún se pueden guardar guías con vehículo y conductor informados.

Las migraciones se ejecutan en orden: v2, v3, v4 y v5, usando los archivos `scratch/upgrade_guias_despacho_vN.sql` correspondientes. Si v4 ya está instalada, ejecutar solamente v5. Conservan las guías, artículos, auditoría, catálogos, parámetros y contador de folios. La versión v3 elimina las sesiones y funciones de autenticación separadas del módulo.

1. Abrir el editor SQL de Supabase, pegar el contenido completo de la migración pendiente y ejecutarlo.
2. Confirmar la versión con `select public.guias_modulo_version();`, cuyo resultado debe ser `5`.
3. Recargar la aplicación actualizada. La sesión principal existente permite operar en Guías sin confirmar nuevamente la clave, incluso tras abrir otra pestaña.

Sin v3 la interfaz mantiene consulta y exportación y deshabilita las operaciones. Con v3 permite guardar guías completas; para dejar vehículo o conductor en blanco requiere v4 y para guardar una descripción requiere v5. Si falta una actualización avisa sin perder el formulario. No sustituye un error del servidor por un guardado local ficticio.

Para una instalación nueva, ejecutar primero `scratch/setup_guias_despacho.sql` y después v2, v3, v4 y v5. Si se reaplica una versión anterior, volver a ejecutar las posteriores para conservar todas las capacidades.

## Funciones implementadas

- Apartado propio en **Guías de Despacho → Configuración**, con las pestañas Guías y Configuración dentro del mismo módulo. Permite editar empresa/emisor y agregar, buscar o retirar vehículos, choferes y destinos. Disponible para supervisores y administradores.
- Los catálogos se cargan desde la base de datos y actualizan las opciones de emisión y edición. Una lista vacía permanece vacía; el arranque no incorpora vehículos, personas ni destinos fijos. Las instalaciones nuevas también comienzan sin datos de negocio predefinidos.
- El retiro de un dato solo afecta las opciones disponibles en próximas guías; las guías históricas conservan el texto registrado. Esta mejora de configuración utiliza las RPC existentes de v3 y no necesita SQL adicional.
- Vehículo, conductor y patente opcionales en creación y edición. Los campos vacíos se guardan vacíos; la vista previa, impresión y PDF dibujan líneas para completarlos a mano. Los valores informados se conservan y se muestran normalmente. Lo escrito en papel no se sincroniza automáticamente con la ficha digital; mientras la guía siga por despachar se puede completar mediante Editar.
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
- Historial por guía con el nombre registrado para el usuario de la aplicación, fecha, detalles y comparación de valores/carga antes y después. Los eventos no pueden actualizarse o borrarse por los clientes del módulo.
- Configuración persistida de empresa/emisor y administración de catálogos, utilizada en las próximas guías y sin reescribir las ya emitidas.
- CSV con una fila por artículo, cantidades numéricas, recepción, seguimiento, filtros y fecha de exportación. No exporta todas las guías cuando una búsqueda tiene cero coincidencias.
- Vista previa sin generar eventos de impresión. La acción de imprimir registra una solicitud de impresión, sin atribuir al navegador confirmación de una impresión física.
- Impresión con estado de la guía y firma registrada, sin superponer el vale de entrega. Ajustes de contraste, filtros y formularios en móvil.

## Estados y permisos

| Acción | Estado permitido | Usuario |
| --- | --- | --- |
| Crear | Nueva guía por despachar | Usuario de la aplicación |
| Editar datos/carga | Por despachar | Usuario de la aplicación |
| Iniciar ruta | Por despachar → En ruta | Usuario de la aplicación |
| Registrar recepción | En ruta → Entregada | Usuario de la aplicación; receptor y firma requeridos |
| Anular | Por despachar / En ruta → Anulada | Supervisor o Administrador; motivo requerido |
| Eliminar | Por despachar | Supervisor o Administrador; conserva evento y no reutiliza folio |
| Configurar empresa y catálogos | No aplica | Supervisor o Administrador |
| Consultar historial / solicitar impresión | Guía existente | Usuario de la aplicación |

El servidor aplica las reglas de datos y consulta el rol del RUT recibido. Las guías entregadas o anuladas no admiten cambios de carga ni reapertura desde este módulo.

## Sesiones y alcance de seguridad

Guías utiliza `currentUser`, la misma sesión principal de la aplicación. No genera tokens, no establece un vencimiento propio ni vuelve a pedir la clave. Cada operación envía el RUT activo; la base obtiene el nombre y rol actuales desde `usuarios`. Cerrar la sesión principal impide nuevas operaciones desde la interfaz y el repositorio. Al iniciar la aplicación se descarta el antiguo token que pudiera quedar en esa pestaña.

La sesión principal actual guarda el perfil en el navegador. Un RUT recibido por la API identifica un usuario pero no demuestra su identidad: sin credencial verificable en el servidor, un cliente que llame directamente a la RPC puede enviar otro RUT existente. La versión v3 utiliza la misma confianza del resto de la aplicación; no debe describirse como autenticación comprobada por el servidor. Una futura autenticación global puede resolverlo sin añadir otra clave al módulo.

La escritura directa sobre las tablas del módulo permanece revocada a los roles de API y las mutaciones siguen pasando por funciones transaccionales. El historial no duplica imágenes de firma en los cambios antes/después.

La autenticación y administración global de usuarios de la aplicación siguen utilizando sus funciones existentes. Esta entrega no migra todos los módulos a Supabase Auth ni modifica los permisos o RPC de gestión de usuarios fuera de Guías de Despacho; ese alcance requiere una revisión global independiente.

## Alcance de bodega

Las guías continúan registrando carga de texto libre. No generan descuentos automáticos de inventario: antes de introducirlos debe definirse qué tipos de guía representan una salida de EPP, un traslado de equipos u otra carga, y cómo evitar descontar dos veces un movimiento ya registrado.

## Verificación

- `npm test`: modelo de búsqueda/exportación, caché, repositorio y migración real en una instancia PostgreSQL aislada mediante PGlite. Incluye fallos inducidos de carga y auditoría, reintentos, estados, permisos, revisiones concurrentes y folios.
- `npm run test:e2e`: interfaz completa en Chrome/Chromium con una API de prueba conectada exclusivamente al PostgreSQL aislado. La URL de Supabase es ficticia; no utiliza registros de producción.
- `npm run build`: compilación de producción.

Las pruebas de navegador requieren Chrome/Edge instalado o los navegadores de Playwright. También se puede definir `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
