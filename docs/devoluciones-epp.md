# Devoluciones de EPP: uso y activación

Primera etapa implementada el 27 de octubre de 2026.

## Activación

1. Ejecutar `scratch/setup_epp_devoluciones.sql` en el editor SQL del proyecto Supabase que usa la aplicación. El script crea la tabla, la operación transaccional y la protección de actas relacionadas; no incorpora datos de ejemplo ni modifica el stock existente. Se puede reaplicar conservando los registros.
2. Publicar esta versión de la aplicación y actualizar la página. La instalación debe preceder a la publicación: mientras falte la tabla, la interfaz muestra una advertencia y no presenta saldos netos como confirmados.

La migración se verificó en PostgreSQL aislado. No se ejecutó en el proyecto remoto desde esta sesión; la consulta de esquema remoto no estuvo disponible con la configuración local.

## Operación

Desde **Ficha del colaborador → Historial → Devolución / saldo**, o desde el botón del mismo nombre al abrir un acta:

- Seleccionar las cantidades de cada línea que realmente vuelve a bodega.
- Indicar motivo y observaciones.
- Confirmar que el material está sin uso, fue recibido y aceptado como apto, y que el stock aún no se corrigió con un ajuste por esa devolución.
- Confirmar la recepción. El comprobante identifica acta, colaborador, artículos, cantidades, fecha y operador, y puede imprimirse.

Se admiten devoluciones parciales, sucesivas y de varios artículos. El servidor valida otra vez el saldo y que la línea original siga correspondiendo al producto y cantidad mostrados. Las líneas repetidas de un mismo SKU en actas antiguas se distinguen por su posición original.

Una recepción confirmada incrementa el stock y reduce la entrega neta. No modifica las cantidades, la firma ni el contexto del acta original. Una vez que un acta tiene devoluciones, queda protegida frente a cambios o eliminación.

Si se pierde la respuesta, reintentar con los mismos datos recupera el comprobante sin volver a sumar stock. Si se cierra el formulario, al abrirlo nuevamente se recargan las devoluciones del servidor para revisar lo que ya quedó registrado. No existe guardado de recepciones exclusivamente en el navegador.

## Ficha, alertas y reportes

- La ficha muestra entregado bruto, devuelto sin uso y entrega neta por producto, además del historial firmado y sus comprobantes.
- Los EPP vigentes se construyen con entregas que mantienen saldo. Al devolver completamente la más reciente, puede volver a aparecer una entrega anterior aún vigente.
- El aviso al preparar una nueva entrega utiliza el último antecedente con saldo. Las alertas históricas consideran las devoluciones que ya se habían recibido a la fecha del evento evaluado.
- Analíticas muestra cantidades netas a una fecha de corte explícita. Si se selecciona un cierre pasado, una devolución posterior no se aplica a ese cierre. Cada período de la comparación usa su propio corte.
- El informe completo y las opciones CSV incluyen entregas netas, entregas originales —incluidas las totalmente devueltas— y devoluciones recibidas por fecha de recepción. El filtro de alerta no se aplica a la sección de devoluciones ni a la sección de originales.
- Historial y reportes incorpora el tipo **Devolución sin uso (+)**. La exportación conserva los movimientos brutos y añade a las entregas sus cantidades devueltas y netas al momento de exportar.

La entrega neta no prueba desgaste ni tenencia actual: descuenta material devuelto sin uso. La cobertura estimada de stock utiliza cantidades netas actuales por entrega, sin restar devoluciones tardías como demanda negativa en el período de recepción.

## Alcance y límites

Esta etapa recibe material sin uso aceptado para reingreso. Productos usados, dañados, bajas, correcciones sin movimiento físico y reversas de devoluciones requieren operaciones distintas y no están habilitados en este formulario.

Las devoluciones antiguas cuyo stock ya fue recuperado con un ajuste **no deben ingresarse otra vez**: duplicarían stock. Queda pendiente un flujo administrativo de vinculación respaldada de ajustes con actas, sin modificar existencias. La interfaz advierte este caso; no intenta deducirlo a partir de notas antiguas.

La operación sigue el contrato de identificación por RUT de la aplicación y obtiene nombre y rol desde `usuarios`; admite Administrador, Supervisor y Bodeguero. No introduce un sistema de autenticación separado.

Las devoluciones son transaccionales y bloquean los saldos afectados. Las demás escrituras de stock ahora comprueban el stock anterior para evitar sobrescribir una devolución concurrente. Los flujos heredados de ingreso y entrega siguen guardando documento y stock en pasos separados: si una operación falla, revisar el movimiento antes de reintentar. La interfaz informa ese conflicto; no sobrescribe silenciosamente el stock confirmado.

También se corrigió el doble incremento de sobrantes en conciliación semanal y se retiró la eliminación automática de actas similares durante la carga. El reinicio masivo queda bloqueado si existen devoluciones o si no pueden verificarse, para conservar sus referencias.

## Verificación

Pruebas de reglas de negocio, repositorio y SQL cubren saldos parciales y totales, fechas de corte, alertas, líneas repetidas, exceso de cantidad, permisos, reintentos, rechazo de cambios de origen, conservación del acta, rollback y precisión de stock entero.

Las pruebas de navegador usan una base PostgreSQL aislada y comprueban ficha, stock, acta, historial, analítica, exportación, respuesta perdida y ausencia de migración. No operan sobre datos reales de Supabase.
