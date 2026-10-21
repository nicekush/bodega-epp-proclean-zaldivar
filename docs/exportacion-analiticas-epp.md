# Exportación de analíticas EPP

El selector «Contenido del CSV» ofrece cuatro salidas. Todas se generan al presionar «Exportar CSV», usando los filtros vigentes y todos los resultados disponibles en la sesión, independientemente de la página visible.

| Salida | Contenido y uso |
| --- | --- |
| Informe completo | Archivo por secciones: contexto y filtros; indicadores; entregas; ranking operador/EPP; resumen por EPP; consumo por área, turno, categoría, mes y motivo; alertas; colaboradores observados; requerimientos; stock y cobertura. |
| Historial de entregas | Tabla plana con una fila por artículo de cada acta seleccionada. Adecuada para filtros y tablas dinámicas. |
| Consumo por operador y EPP | Tabla plana con posición dentro del EPP, cantidad recibida, actas, participación y frecuencia por operador. |
| Resumen por EPP | Tabla plana con cantidades, actas, receptores identificados, fechas, alertas y catálogo/stock actual de referencia. |

## Detalle de las entregas

Incluye ID y referencia del acta, fecha original y fecha local, RUT, nombre, área, turno, ID/código/nombre del artículo, categoría, unidad y cantidad. Incorpora la fecha de entrega anterior en el historial cargado, días transcurridos, vida útil de referencia y clasificación de frecuencia que utiliza el panel.

Cuando están registrados, también incluye motivo, talla, razón del cambio de ropa, comentarios y responsable del registro. Se indica la existencia de firma digital o el texto de registro de firma, sin incluir la imagen codificada.

Los campos ausentes quedan vacíos. El hecho de que un campo aparezca en la exportación no garantiza que los registros antiguos lo contengan.

## Lectura del ranking

- La posición se calcula dentro de cada EPP, por cantidad y luego por número de actas.
- El RUT se normaliza para agrupar formatos con y sin puntos/guion. Las actas sin RUT se mantienen separadas para evitar fusionar personas solo por nombre.
- La participación corresponde a la cantidad de ese EPP incluida en la selección, no al consumo histórico de toda la bodega.
- La frecuencia es el promedio entre fechas de actas del operador y EPP que aparecen en la selección. Queda vacía si hay menos de dos fechas válidas.
- El antecedente individual de una entrega puede ser anterior al período filtrado. Se conserva para explicar las alertas.
- Las cantidades respetan la unidad del catálogo; los resúmenes por dimensiones separan pares, unidades, cajas, etc.

## Alcance de los bloques de referencia

El informe completo documenta los alcances distintos que ya utiliza el panel:

- Las entregas y sus resúmenes aplican área, categoría, SKU, turno, búsqueda de operador/RUT, fechas y estado de alerta.
- Los requerimientos utilizan el filtro de área y las fechas de solicitud. Los campos actuales no permiten relacionar todos sus artículos de texto libre con un SKU. No se presentan como parte del total de entregas filtradas.
- El stock y la cobertura corresponden al catálogo actual y todo el historial cargado, restringidos por categoría. Se incluyen cantidad histórica, fechas de la base, consumo diario y cobertura decimal para revisar el cálculo. Sin consumo observado, la cobertura numérica queda vacía. También se conserva el texto y riesgo mostrados por el modelo actual del panel.
- «Colaboradores observados» conserva la tabla existente, cuyo promedio usa un umbral del 55%. La sección de alertas por entrega utiliza el 50%, igual que el indicador actual. Ambos criterios se explican en el contexto.

Estos alcances quedan documentados; esta mejora de exportación no sustituye las reglas actuales de cálculo del panel ni incorpora datos que no se hayan cargado desde el servidor.

## Formato y trazabilidad

CSV UTF-8 con BOM, separador punto y coma, decimales con coma y campos entre comillas. Se preservan tildes, comillas, punto y coma y saltos de línea de comentarios. Los textos que podrían interpretarse como fórmulas se exportan como texto.

El informe completo registra filtros y fecha de generación. Las tres tablas independientes repiten esa información en las columnas finales, sin títulos ni filas previas a la cabecera, para facilitar su importación.

## Validación

Ejecutar `npm test` para verificar selección, detalle, ranking, ausencia de límites de paginación, datos incompletos y lectura del CSV. Ejecutar `npm run build` para validar la compilación de la aplicación.
