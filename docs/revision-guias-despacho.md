# Revisión del módulo de Guías de Despacho

Fecha: 21 de octubre de 2026.

Actualización: las correcciones del módulo están implementadas en [Guías de Despacho v2](mejoras-guias-despacho-v2.md). Su activación transaccional requiere ejecutar la migración SQL indicada allí. El análisis que sigue conserva los hallazgos originales de la revisión.

## Alcance

Revisión del código actual de `src/guias.js`, su integración en `src/main.js`, la persistencia en `src/db.js`, el HTML y el script de instalación SQL. Incluye los cambios locales pendientes de Guías de Despacho.

Se ejecutaron ocho comprobaciones aisladas del código real, con base de datos y DOM simulados. No se consultó ni modificó la base de producción y no se comprobó visualmente la impresión en navegador. Las recomendaciones de permisos describen el script del repositorio; no certifican la configuración real desplegada.

## Hallazgos

### [P1] Se informa éxito aunque el servidor rechace el guardado

**Ubicación:** `src/db.js:1269–1288`; patrón similar en actualización, eliminación y cambios de estado.

Ante errores de conexión, permisos o folio duplicado, se crea un ID con `Date.now()`, se guarda el registro en memoria/localStorage y se devuelve normalmente. `saveNewGuia` muestra «emitida correctamente» e incluso permite imprimirla. No hay una cola de sincronización ni un estado visible de pendiente de envío para esa guía.

**Comprobación:** al simular rechazo por folio duplicado, la función devuelve una guía con ID local y agrega el registro a la lista como si el guardado hubiera sido exitoso.

**Corrección propuesta:** distinguir un registro confirmado en servidor de un borrador local pendiente. Propagar errores de validación y permisos; habilitar confirmación/impresión según el estado real de persistencia. Si se requiere trabajo sin conexión, implementar sincronización explícita con reintentos y resolución de conflictos.

### [P1] La guía y su carga pueden quedar guardadas parcialmente

**Ubicación:** `src/db.js:1246–1257` y `src/db.js:1303–1313`.

La creación inserta primero la cabecera. Si falla la carga, solo registra una advertencia y continúa: el navegador muestra productos que no quedaron en el servidor. Al editar, se eliminan todos los ítems y se insertan los nuevos sin comprobar los errores de ambas operaciones. Un fallo entre ambas puede dejar la guía sin carga.

**Comprobaciones:** un fallo de inserción de ítems devuelve una guía aparentemente completa en memoria; una edición elimina los originales, ignora el fallo de reemplazo y muestra el nuevo contenido local.

**Corrección propuesta:** guardar cabecera, detalle y auditoría como una operación transaccional del servidor; devolver el resultado persistido. No eliminar el detalle anterior hasta poder confirmar la nueva versión de forma atómica.

### [P1] Los estados y el contenido firmado pueden modificarse sin controles

**Ubicación:** `src/guias.js:542–642`, `index.html:2749–2765`, `src/db.js:1291–1335`.

El formulario permite editar cualquier guía, incluyendo las entregadas y anuladas, cambiar el folio y seleccionar `ENTREGADA` directamente. El guardado no aplica reglas de transición ni exige receptor o evidencia. También permite cambiar los productos de una guía que conserva una firma anterior.

**Comprobación:** una guía pendiente se actualiza a `ENTREGADA` con receptor y firma vacíos mediante la misma función usada por el formulario.

**Corrección propuesta:** validar las transiciones en servidor y usar un flujo específico de recepción. Bloquear o versionar cambios de carga y folio después de confirmar la entrega. Registrar la anulación mediante su operación específica, con motivo, en lugar de un cambio genérico de estado.

### [P1] La interfaz local tiene controles sin implementación

**Ubicación:** `index.html:1586–1618` y `index.html:3067–3187`; integración en `src/main.js:110–141` y `src/main.js:431–458`.

Se encontraron ocho funciones utilizadas por el HTML que no están definidas ni expuestas:

- `handleGuiasDateFilter`
- `handleGuiasDestinoFilter`
- `clearGuiasFilters`
- `openGuiasConfigModal`
- `closeGuiasConfigModal`
- `switchGuiasConfigTab`
- `saveGuiasConfigEmpresa`
- `addGuiasCatalogoItem`

Estos controles producen errores al interactuar con ellos. El filtro de destino solo contiene su opción inicial. Además, `gd-timeline-container` está presente, pero el drawer no carga ni representa los eventos y no utiliza `dbFetchGuiasAuditLogs`.

**Corrección propuesta:** completar funciones, enlaces globales, carga de catálogos, estado de filtros y representación de auditoría antes de publicar los cambios locales.

### [P2] Una búsqueda sin coincidencias exporta todas las guías

**Ubicación:** `src/guias.js:861–862`.

La expresión `filteredGuias.length > 0 ? filteredGuias : dbGuias` interpreta cero coincidencias como ausencia de filtro. Por tanto, una tabla sin resultados genera un archivo con registros ajenos a la búsqueda.

**Comprobación:** buscar un texto inexistente produce el mensaje «No se encontraron guías», pero el CSV incluye la guía de prueba.

**Corrección propuesta:** aplicar siempre los filtros actuales al conjunto exportado. Una selección vacía debe generar un aviso o una tabla vacía, sin volver al conjunto completo. El archivo también debe separar los ítems en filas si se desea analizar cantidades por producto.

### [P2] Se acepta un lienzo vacío como firma digital

**Ubicación:** `src/guias.js:723–741`.

La recepción convierte el canvas a PNG sin verificar trazos. Un canvas vacío también genera una imagen válida, por lo que el registro y el remito pueden indicar firma digital aunque nadie haya firmado.

**Comprobación:** enviar el formulario con un canvas simulado sin trazos llama igualmente a `dbConfirmarEntrega` con una imagen de firma.

**Corrección propuesta:** registrar si existe un trazo válido, reiniciar ese estado al limpiar o abrir el formulario y definir si la firma es obligatoria. Si existe recepción sin firma, identificarla expresamente.

### [P2] Los registros eliminados pueden reaparecer desde caché

**Ubicación:** `src/db.js:196–224` y `src/db.js:1177–1199`.

La carga inicial trata una tabla vacía como error y usa caché o semilla histórica. La recarga tampoco reemplaza la lista si el servidor devuelve cero registros. Así, una eliminación válida del último registro no se refleja necesariamente en otro navegador con caché.

**Comprobación:** una consulta exitosa con cero guías conserva una guía local anterior.

**Corrección propuesta:** aceptar la lista vacía como un resultado válido del servidor y reservar la caché para errores reales de conectividad. Cargar semillas mediante una operación de instalación explícita.

### [P2] El folio se calcula en cada navegador

**Ubicación:** `src/guias.js:288–293` y `src/db.js:1203`.

Se utiliza el mayor folio de la lista cargada más uno. Dos operadores pueden obtener el mismo número; la restricción única del servidor rechazará uno y el mecanismo de guardado local ocultará ese conflicto. El campo de edición sigue permitiendo cambiar el folio pese a que el de creación ahora es de solo lectura.

**Corrección propuesta:** reservar el folio en servidor con una operación segura ante concurrencia, mantener su identidad y comunicar los conflictos. Este hallazgo se deriva del algoritmo; no se ejecutó una prueba concurrente contra el servidor real.

### [P1, condicionado al despliegue] La auditoría no queda protegida por el script SQL

**Ubicación:** `scratch/setup_guias_despacho.sql:85–99`.

Las políticas de instalación autorizan todas las operaciones con condiciones `true`, incluida la modificación/eliminación de eventos de auditoría, sin comprobar rol. Si los roles de API tienen los permisos de tabla correspondientes, esa configuración no impone una auditoría inmutable ni diferencia quién puede anular, editar o borrar guías.

**Corrección propuesta:** verificar los permisos reales de producción, vincular las operaciones a identidad autenticada y proteger la auditoría contra modificación/eliminación por clientes. El usuario y el evento deben originarse en el servidor para ofrecer trazabilidad confiable.

### [P1] Descripciones y nombres se insertan como HTML sin escape

**Ubicación:** `src/guias.js:151–165`, `src/guias.js:487–492`, `src/guias.js:589–590`, `src/guias.js:820–833`, `src/guias.js:946–949`.

Los datos guardados se interpolan en contenido HTML, atributos `value` y manejadores `onclick`. Una descripción con comillas puede romper la edición; contenido HTML introducido en una guía puede convertirse en código activo cuando otro operador la visualiza.

**Corrección propuesta:** usar `textContent`, asignación de propiedades y eventos con `addEventListener`; tratar firmas como recursos validados. Este hallazgo se verificó por lectura del flujo de datos; no se ejecutó contenido activo en un navegador.

## Otras observaciones

- Abrir la vista previa registra `IMPRESION` antes de que se invoque `window.print()`. Cancelar o simplemente cerrar la vista deja un evento de impresión que no demuestra que el documento se haya impreso.
- La configuración tiene una función local de guardado, pero no se carga en la inicialización ni se utiliza para construir las nuevas guías, que siguen tomando valores predeterminados del código.
- La búsqueda promete encontrar `#40`, pero compara el texto con el folio numérico sin quitar `#`. Tampoco normaliza tildes ni busca patente, observaciones o emisor.
- La tabla limita la página después de construir sus filas. Si se reduce la lista estando en una página alta —por ejemplo, al eliminar un registro— puede quedar momentáneamente vacía pese a existir resultados.
- Las consultas no tienen paginación explícita del servidor: comprobar que el historial disponible esté completo cuando crezca el volumen.

## Oportunidades funcionales

1. **Búsquedas y filtros:** fechas y destinos operativos; búsqueda por folio con o sin `#`; selección de chofer, vehículo, patente, receptor y estado; filtros relacionados con cantidades de resultados.
2. **Historial verificable por guía:** creación, edición, inicio de ruta, recepción, anulación y apertura/impresión de documento, con usuario, fecha y cambios antes/después cuando corresponda.
3. **Seguimiento logístico:** antigüedad de pendientes, tiempo entre despacho y recepción, guías en ruta por destino y responsable, y entregas con observaciones.
4. **Exportación analizable:** una fila por artículo con ID/folio, destino, vehículo, chofer, cantidades, unidad, estado y recepción. Conservar los filtros y referencias para reconstruir cada resumen.
5. **Relación con bodega, si se requiere:** actualmente el módulo registra carga con descripciones libres, sin vínculo a SKU ni movimientos de stock. Definir qué tipos de guía representan salidas de inventario, traslados de equipos u otras cargas antes de incorporar movimientos automáticos.

## Orden recomendado

Primero resolver persistencia y operaciones parciales, luego estados/recepción y controles incompletos. Después conectar trazabilidad, asegurar permisos y folios, y mejorar búsqueda y exportación. Las oportunidades analíticas necesitan esa base para representar lo que efectivamente ocurrió.

No se modificó el funcionamiento del módulo durante esta revisión.
