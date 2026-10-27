# Devoluciones de EPP vinculadas a entregas

Fecha: 27 de octubre de 2026.

Estado: primera etapa implementada. Ver uso, activación y límites en [devoluciones-epp.md](devoluciones-epp.md). Este documento conserva el diagnóstico y la propuesta inicial.

## Diagnóstico

El sistema registra entregas, ajustes y retornos de préstamos, pero no dispone de una devolución de EPP de consumo vinculada al acta original. Un ajuste puede recuperar el stock sin corregir la cantidad atribuida al colaborador.

Evidencia en el código revisado:

- `src/inventory.js`, `saveAdjustStock`: actualiza inventario y crea una auditoría de ajuste. No relaciona el movimiento con una entrega ni con su receptor.
- `src/db.js`, `dbInsertAjusteStock`: el registro contiene producto, cantidades, motivo y operador; no tiene relación estructurada con acta o colaborador.
- `src/workers.js`, `searchWorkerProfile`: construye los EPP vigentes y el historial desde `dbSalidas`, sin descontar devoluciones.
- `src/outflow.js`, `checkEPPConsumptionDeviation`: busca la última entrega del SKU al colaborador, aunque después se haya recuperado físicamente.
- `src/analytics.js`: suma cantidades originales y utiliza entregas originales para frecuencia y cobertura. `src/analytics-export.js` exporta ese resultado.
- `src/reports.js`, `renderHistoryTable`: consolida ingresos, salidas y recepciones de insumos; no contempla devoluciones de colaboradores.
- `src/db.js`, `dbRetornarPrestamo`: resuelve retornos del flujo de préstamos y equipos con serie. No resuelve la devolución de un EPP registrado como consumo.

Se reprodujo el problema ejecutando las funciones actuales de ajuste y alerta con datos ficticios y una interfaz simulada: stock inicial 7, acta de 3 unidades y ajuste positivo de 2 por devolución. El stock queda en 9, la entrega conserva 3 y la alerta por frecuencia sigue considerando el acta. No se consultaron ni modificaron datos de producción.

## Solución propuesta

Agregar **Registrar devolución** al historial del colaborador y al detalle del acta. La devolución debe identificar la entrega y sus artículos; su receptor se obtiene del acta, evitando imputarla a otra persona.

Flujo:

1. Abrir una entrega del colaborador.
2. Mostrar por producto: entregado, devuelto y saldo disponible para devolver.
3. Seleccionar los artículos y cantidades, admitiendo devoluciones parciales y sucesivas.
4. Registrar motivo, condición y observaciones. Para el primer alcance: devolución sin uso aceptada por bodega como apta para reingreso.
5. Mostrar el efecto antes de guardar: unidades que vuelven al stock y saldo atribuido al colaborador.
6. Confirmar la recepción con operador, fecha y comprobante. Conservar intacta el acta firmada y enlazar ambos documentos.

Ejemplo, stock anterior a la entrega: 10 unidades.

| Movimiento | Stock disponible | Entregado bruto | Devuelto sin uso | Entrega neta atribuida |
| --- | ---: | ---: | ---: | ---: |
| Entrega de 3 unidades | 7 | 3 | 0 | 3 |
| Devolución de 2 unidades | 9 | 3 | 2 | 1 |
| Devolución de la unidad restante | 10 | 3 | 3 | 0 |

La entrega neta es una medida de imputación, no una prueba de consumo físico ni de tenencia actual. El sistema tampoco conoce el desgaste real del producto.

## Reglas de negocio

- **Sin uso y aceptado como apto:** aumenta el stock disponible y reduce la entrega neta atribuida.
- **Usado o dañado:** requiere otro tratamiento. La recepción física no debe borrar el consumo ni incorporar automáticamente el producto al stock disponible. Una futura etapa puede distinguir revisión, recuperación y baja.
- **Error de registro sin devolución física:** corresponde a una corrección o anulación trazable de entrega. No debe registrarse como recepción de material inexistente.
- **Cambio de talla:** si el original vuelve sin uso y es aceptado, devolverlo contra su entrega y registrar la nueva entrega del SKU correcto. Enlazar ambos movimientos como cambio para explicar la reposición.
- No borrar ni reducir las cantidades del acta original: representan lo entregado y firmado.
- Saldo devolvible por artículo = cantidad original menos devoluciones vigentes de ese artículo. Debe validarse nuevamente en el servidor al confirmar.
- Una devolución total cierra el saldo del artículo; una parcial deja el saldo pendiente. El estado del acta se deriva del conjunto de sus artículos.
- Los ajustes por diferencias de conteo continúan existiendo; no se interpretan automáticamente como devoluciones de una persona.

## Ficha, alertas y reportes

- Mostrar **entregado**, **devuelto sin uso** y **entrega neta** en la ficha, con acceso a los documentos.
- Excluir de los EPP vigentes las líneas totalmente devueltas. Si existe una entrega anterior con saldo y vigencia, considerarla en su lugar. Una devolución parcial mantiene la fecha original y solo reduce la cantidad atribuida.
- Recalcular las alertas por persona y SKU con las entregas que conservan saldo. Devolver por completo el último artículo no debe seguir iniciando su plazo de reposición. Si existe una entrega previa con saldo, esa entrega sigue siendo un antecedente válido.
- Para reconstruir una alerta histórica, usar únicamente las devoluciones conocidas hasta la fecha de esa entrega. Distinguir esa evaluación de la situación actual corregida.
- Agregar la devolución al historial como movimiento propio, con enlace al acta, y actualizar las exportaciones con el mismo criterio de cálculo.
- Mantener visibles dos lecturas temporales: **movimientos del período**, según fecha de entrega y devolución, y **saldo de una entrega al corte**, según sus devoluciones hasta una fecha elegida. Una entrega de septiembre devuelta en octubre no debe desaparecer silenciosamente de septiembre.
- La cobertura de stock debe explicitar su ventana y el tratamiento de devoluciones. Una devolución tardía no puede producir una demanda negativa usada como pronóstico.

## Base técnica necesaria

Crear registros persistentes de devolución, con cabecera y detalle: identificador, acta original, referencia estable a su línea, SKU, cantidad, condición, motivo, fecha efectiva, fecha de registro y operador. La identidad del colaborador y el contexto histórico provienen del acta. La referencia de línea debe poder distinguir artículos repetidos en datos antiguos.

Una función transaccional en la base debe comprobar los permisos, bloquear los registros afectados, validar los saldos, guardar devolución y auditoría e incrementar el stock una sola vez. Usar una clave de solicitud única para que doble clic o reintento no duplique el movimiento. Si falla un paso, no se aplica ninguno. No informar éxito con una devolución guardada únicamente en el navegador.

La concurrencia requiere revisar también las otras escrituras de stock: actualmente varias calculan un total con datos locales y lo sobrescriben. La transacción de devolución, por sí sola, no evita que otra operación posterior sobrescriba ese stock con un valor desactualizado.

Centralizar el cálculo de saldos por línea y fecha de corte, para reutilizarlo en ficha, alertas, analíticas y exportaciones. Si posteriormente se permite revertir una devolución, hacerlo mediante un movimiento compensatorio autorizado, con validación de stock disponible y auditoría, sin editar o borrar el original.

## Registros históricos ya ajustados

No convertir motivos o notas de ajustes anteriores en devoluciones automáticamente. No prueban qué acta o persona corresponde.

Cuando se acredita que el stock ya fue recuperado mediante un ajuste, permitir una regularización administrativa que vincule ese ajuste con la entrega y corrija la imputación **sin aumentar nuevamente el stock**. Debe quedar respaldada y limitar cuánto del ajuste puede vincularse. Si no hay evidencia suficiente, dejar el caso para revisión.

## Hallazgos que afectan la implementación

1. **Doble incremento en conciliación:** `src/reconciliation.js`, `confirmSaveReconciliationWithSignature`, establece primero el conteo físico mediante `dbUpdateEPPStock` y luego registra el sobrante con `dbInsertInflow`, que vuelve a incrementar el stock en `src/db.js`. Por lectura del código, pasar de 10 a un conteo físico de 12 puede terminar en 14. Corregir este comportamiento antes de usar la conciliación como base de regularizaciones.
2. **Eliminación automática de entregas:** `initDatabase` ejecuta `dbCleanDuplicateOutflows`, que identifica actas similares en un intervalo de 90 segundos, elimina registros y restituye stock. Antes de incorporar devoluciones referenciadas, revisar este proceso: no debe eliminar un acta con devoluciones ni tratar una nueva entrega legítima como duplicada solo por su parecido temporal.

## Alcance inicial y aceptación

Primer alcance recomendado: devolución total o parcial sin uso, recibida y aceptada por bodega; vínculo obligatorio al acta; comprobante; stock y saldos transaccionales; ficha, alertas, historial y exportaciones consistentes. Los artículos usados o dañados requieren un flujo separado y una política explícita.

Validar al implementar: devolver 2 de 3 deja saldo 1; devolver el resto deja saldo 0; exceder el saldo se rechaza; devoluciones de distintos SKU se aplican correctamente; doble clic, reintentos y operadores concurrentes no duplican stock; un fallo no deja movimientos parciales; el acta firmada se conserva; una devolución en otro mes respeta las fechas de corte; regularizar una devolución ya ajustada no repone dos veces.

Este documento propone el comportamiento; no implementa cambios funcionales ni migraciones.
