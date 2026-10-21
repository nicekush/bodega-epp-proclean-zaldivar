# Diagnóstico y oportunidades de mejora: analíticas EPP

Fecha: 21 de octubre de 2026.

## Alcance y conclusión

Se revisaron el módulo de analíticas, su interfaz y los flujos de inventario, entregas, requerimientos y abastecimiento. Se ejecutó el código actual de `src/analytics.js` en un entorno aislado de Node, con datos ficticios y una interfaz simulada, sin importar la conexión a la base de datos.

El apartado ya ofrece filtros, indicadores, gráficos, tablas y exportación. La primera mejora debe ser la coherencia de los cálculos: algunos indicadores comparan universos distintos o muestran conclusiones que los datos no permiten sostener. Después conviene orientar el panel a decidir qué reponer, qué cambios revisar y dónde investigar aumentos de consumo.

Este diagnóstico no modifica el funcionamiento de la aplicación. No se consultaron registros de producción ni se realizó una revisión visual en navegador; los hallazgos corresponden al código y a comprobaciones aisladas. No permiten cuantificar cuántos registros reales están afectados.

## 1. Correcciones prioritarias

### 1.1 Comparar períodos con los mismos filtros — prioridad alta

**Evidencia:** `src/analytics.js:273–291`.

El período actual aplica área, turno, trabajador, categoría, SKU y estado de alerta. El anterior solo aplica área y turno, y suma todos los artículos. Por ello, una comparación filtrada puede presentar variaciones falsas.

**Comprobación:** con 10 guantes en el período actual y 10 guantes más 90 cascos en el anterior, al seleccionar guantes aparece una caída del 90%. Para ese SKU la variación es 0%.

**Mejora:** utilizar una misma función de selección para ambos períodos, con intervalos de igual cantidad de días calendario. Mostrar sus fechas y cantidades. Expresar una base anterior igual a cero como «sin base de comparación». Un aumento de entregas debe presentarse de manera neutral hasta conocer cambios de dotación o actividad.

**Aceptación:** el ejemplo anterior muestra 0%; trabajador y categoría restringen ambos períodos; los límites de fecha no se solapan.

### 1.2 Dar una base explícita a la cobertura de stock — prioridad alta

**Evidencia:** `src/analytics.js:929–983`.

La autonomía utiliza todo el historial, divide por el tiempo entre la primera y la última entrega y solo restringe el catálogo por categoría. No explica que su alcance difiere del resto del panel. Tampoco incorpora los días sin movimiento posteriores a la última entrega ni distingue artículos con poco historial.

Se confirmaron dos resultados problemáticos:

- Un artículo con cinco unidades y ninguna entrega aparece como «Estable (+90 d.)» y riesgo bajo. No existe historial para estimar esa cobertura.
- Un artículo con una unidad y consumo medio de veinte unidades diarias aparece como «0 días (Agotado)». Tiene stock; su cobertura es inferior a un día.

**Mejora:** mostrar stock actual, ventana de consumo —por ejemplo, últimos 30/60/90 días—, promedio diario, cobertura y calidad de la estimación. Diferenciar «agotado», «menos de un día», «sin consumo observado» e «historial insuficiente». Mantener el valor numérico separado del texto y eliminar el centinela `999`.

La cobertura de una bodega compartida necesita la demanda de todas las áreas que abastece. Los filtros de persona o área no deberían reducir silenciosamente esa demanda. La ventana y el alcance de este panel deben quedar visibles; categoría y SKU sí pueden seleccionar los artículos mostrados.

**Aceptación:** stock positivo nunca recibe la etiqueta «agotado»; ausencia de historial no se presenta como estabilidad; los días sin entregas forman parte de la ventana cuando existe cobertura de datos confirmada.

### 1.3 Separar pendientes vencidos del cumplimiento histórico del SLA — prioridad alta

**Evidencia:** `src/analytics.js:299–310`, `src/db.js:733–784`, `src/supplies.js:1135–1151`.

El indicador descuenta únicamente solicitudes todavía pendientes con más de 48 horas. Todas las cerradas cuentan favorablemente, sin evaluar cuándo se completaron. Sin solicitudes devuelve 100%.

**Comprobación:** una solicitud ficticia creada el 1 de enero y recibida el 20 de enero arroja 100%, incluso proporcionándole una fecha de entrega: el cálculo no la utiliza.

Además, el filtro por área busca `area_trabajador` o `area`, pero el flujo revisado de creación no guarda esos campos. Seleccionar un área puede excluir solicitudes y producir un 100% sin datos. Los umbrales del módulo de requerimientos también difieren: allí la etiqueta «Vencido» comienza a los cuatro días.

**Mejora:** separar «pendientes fuera de plazo» de «solicitudes completadas dentro del plazo». Registrar fecha de cierre completo, relación con la entrega y área de la solicitud; definir el plazo por prioridad y el tratamiento de entregas parciales. Cuando no hay registros elegibles, mostrar «sin datos». No reconstruir fechas de cierre antiguas sin evidencia suficiente.

**Aceptación:** cerrar una solicitud atrasada no transforma su resultado histórico en cumplimiento; los módulos utilizan la misma política; un filtro sin registros no produce 100%.

### 1.4 Hacer que cada alerta tenga un detalle verificable — prioridad alta

**Evidencia:** `src/analytics.js:214–240`, `src/analytics.js:742–792`.

El indicador compara cada entrega con el historial completo y usa un umbral del 50% de la vida útil. La tabla calcula un promedio únicamente con las entregas filtradas y usa el 55%. Además agrupa por RUT, nombre y área, lo que puede fragmentar una misma persona.

**Comprobaciones:**

- Una reposición dentro del período y su entrega anterior fuera de él generan una alerta en el indicador, pero ninguna fila en la tabla.
- Dos actas con fecha y hora idénticas generan cero alertas en el indicador y una fila observada en la tabla. Es necesario distinguir reposiciones reales de registros duplicados o simultáneos.

El conteo de alertas y su denominador se calculan antes de aplicar el filtro de estado, mientras que el total entregado se calcula después. Si el gráfico conserva contexto global, debe explicitarlo.

**Mejora:** construir una sola lista de eventos clasificados, con persona identificada por RUT normalizado, SKU, entrega anterior, entrega actual, intervalo, regla aplicada y motivo registrado. Reutilizarla en tarjetas, gráficos, detalle y exportación. Separar el promedio histórico de los eventos que originan una alerta en el período.

**Aceptación:** cada alerta visible permite consultar el evento que la explica, aunque el antecedente sea anterior al período. El significado de cada porcentaje y denominador está indicado.

### 1.5 Conservar el contexto histórico de las entregas — prioridad alta

**Evidencia:** `src/db.js:1134–1154`.

Actualizar la ficha de un trabajador cambia nombre, área y turno en todas sus salidas anteriores. Así, un traslado de área puede mover consumo pasado hacia la nueva área.

**Mejora:** separar el perfil vigente de la persona y el contexto registrado en cada entrega. Las correcciones de registros históricos deben ser operaciones explícitas y trazables. Evaluar una migración antes de cambiar este flujo; el código actual no permite saber qué cambios anteriores fueron traslados y cuáles fueron correcciones válidas.

**Aceptación:** un cambio de área actual no altera los resultados de meses anteriores.

### 1.6 Representar correctamente los turnos — prioridad media

**Evidencia:** `src/analytics.js:246–249`, `index.html:883–887`, `src/db.js:105–112`.

El sistema permite administrar turnos, pero analíticas ofrece únicamente A y B. Cualquier valor que no contenga la letra «b», incluido un turno vacío, se suma al A.

**Comprobación:** tres unidades entregadas sin turno producen «Turno A: 3 u.» y una relación de 100% / 0%.

**Mejora:** utilizar el catálogo real y una categoría «Sin turno». Mostrar distribución por turno y, cuando exista dotación confiable, consumo por persona o jornada.

## 2. Oportunidades para la gestión de bodega

| Oportunidad | Decisión que facilita | Datos y dependencias |
| --- | --- | --- |
| Lista priorizada de reposición | Qué solicitar primero y cuánto | Stock, consumo reciente, stock mínimo y pedidos pendientes; incorporar plazo de proveedor y stock de seguridad. |
| Fecha estimada de quiebre y fecha sugerida de pedido | Cuándo gestionar una compra | Cobertura corregida y plazo de abastecimiento; mostrar incertidumbre y evitar fechas cuando la base es insuficiente. |
| Seguimiento de cambios de EPP | Qué reposiciones investigar | Aprovechar `motivo_entrega`, comentarios y razones de cambio ya capturados; habilitar revisión y justificación. Una frecuencia alta por sí sola no demuestra mal uso. |
| Comparación de áreas y turnos | Dónde revisar una variación | Mostrar volumen y consumo por receptor; para comparar por dotación o jornada se necesita el denominador correspondiente. |
| Tendencias por categoría o SKU | Qué demanda está cambiando | Serie diaria/semanal/mensual, períodos comparables y meses sin entregas cuando la carga esté completa. |
| Exportación reproducible | Compartir y justificar decisiones | Fecha de generación, filtros, ventanas, KPI, denominadores y detalle que permita reconstruir el resultado. |
| Consumo valorizado | Qué artículos concentran el gasto | Incorporar costo unitario y criterio de valoración. El catálogo y flujo de entregas revisados no aportan un costo utilizable para este cálculo. |

El consumo por persona que ya aparece en el gráfico de áreas divide por quienes recibieron EPP, no por la dotación total. Conviene etiquetarlo como «por receptor» para evitar una interpretación incorrecta.

## 3. Presentación y mantenibilidad

- **Orden del panel:** indicadores operacionales y reposición prioritaria; después tendencias; finalmente revisión de eventos y detalle. Los filtros avanzados pueden quedar plegables, con un resumen siempre visible de los activos.
- **Nombres precisos:** «Cobertura estimada de stock» resulta más directo que «Runway». El actual «Pareto» es un ranking de cinco SKU: añadir participación acumulada o llamarlo «Más entregados». «Entregado» describe lo registrado; no mide el desgaste o uso efectivo.
- **Gráficos temporales:** la serie actual omite meses sin movimientos y los puntos quedan igualmente espaciados. Completar el calendario y distinguir cero entregas de datos ausentes.
- **Fechas y filtros:** validar que desde no sea posterior a hasta; definir inclusividad de «últimos 7/30/90 días»; usar fechas calendario locales en vez de derivar la fecha visible con `toISOString()`. Los selectores se inicializan una sola vez y deben actualizarse si cambia el catálogo.
- **Trazabilidad de datos:** mostrar última actualización y período efectivamente disponible. `src/db.js:115–139` carga tablas con consultas sin paginación explícita; verificar integridad y límites del servidor antes de interpretar los resultados como historial completo.
- **Rendimiento:** por cada artículo de una entrega se recorre y ordena de nuevo el historial. Preparar índices por SKU y por persona/SKU, y clasificar cronológicamente una vez. Medir con un volumen representativo; no se ha cuantificado lentitud real.
- **Separación del cálculo:** extraer funciones puras para selección, comparación, alertas y cobertura. El renderizado debe consumir un resultado común. Verificar esas funciones con casos de negocio que detecten las inconsistencias documentadas.
- **Interacción y contenido:** sustituir interpolaciones de nombres y categorías en manejadores `onclick` por eventos y texto seguro, para que apóstrofes o caracteres especiales no rompan filtros. Comprobar navegación por teclado y legibilidad de nombres largos en una revisión visual posterior.

## 4. Orden propuesto de implementación

1. **Base confiable:** filtros equivalentes, períodos calendario, eventos de alerta compartidos, cobertura con estados explícitos, turnos reales y SLA correctamente identificado. Resolver la conservación del contexto histórico antes de ampliar comparaciones por área.
2. **Decisiones operacionales:** reposición priorizada, integración con solicitudes de abastecimiento existentes, tendencias y explicación de cambios de EPP. Las sugerencias de pedido deben permitir revisión antes de generar solicitudes.
3. **Gestión económica y previsión:** costos, plazos por proveedor, demanda variable y estimaciones con confianza visible. Requiere mejorar datos antes de presentar resultados.

Para la primera entrega, el criterio principal es que una misma selección produzca cifras consistentes entre tarjetas, gráficos, tablas y exportaciones, con el alcance de stock y requerimientos expresado explícitamente cuando sea diferente.

## 5. Resumen de comprobaciones aisladas

Se ejecutaron ocho escenarios sobre el código actual. Siete evidencian inconsistencias de cálculo o presentación: comparación de SKU, alerta sin fila, ausencia de historial tratada como estabilidad, stock positivo etiquetado como agotado, turno ausente asignado al A, solicitud cerrada tarde contada favorablemente y entregas simultáneas con resultados de alerta distintos.

El octavo escenario comprobó que una duración de cero se sustituye por seis meses. El formulario actual exige un mínimo de un mes, por lo que este caso corresponde a validación de datos heredados o externos y no se considera una corrección funcional prioritaria. Debe definirse una política explícita para datos inválidos o incompletos.
