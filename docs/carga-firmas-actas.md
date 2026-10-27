# Firmas de actas bajo demanda

Fecha: 27 de octubre de 2026.

## Comportamiento

La carga inicial conserva todas las actas y su paginación de 500 registros, pero no solicita `salidas.firma`. Mantiene los campos operacionales que usan ficha, entregas, devoluciones y reportes: identificador, colaborador, RUT, área, fecha, artículos, operador, turno y los campos opcionales de motivo, comentarios y vestuario.

Para mantener compatibilidad con versiones anteriores de la base, únicamente se retiran de la consulta las columnas opcionales que el servidor confirma que no existen. Un error de permisos, conexión o ausencia de una columna obligatoria sigue deteniendo esa carga. La lista de columnas disponibles se conserva durante la sesión.

Al abrir un acta se solicita únicamente su identificador y firma. Las consultas simultáneas del mismo documento comparten la petición y el resultado confirmado se conserva en memoria. Una recarga de página vuelve a validar los datos. Las nuevas entregas que ya contienen su firma no requieren otra consulta.

## Presentación e impresión

- Una firma pendiente se muestra como «Consultar en acta» en la ficha y «Pendiente de consultar en acta» en el CSV; no se interpreta como física, inexistente o digital confirmada.
- Al abrir el acta se ocultan las firmas del documento anterior y se muestra el estado de carga.
- El botón de impresión espera la respuesta y la decodificación de la imagen digital. Una solicitud de impresión programática también espera esa confirmación.
- Si falla la lectura o la imagen, el botón permanece bloqueado y aparece «Reintentar firma». El reintento vuelve a consultar el servidor.
- Cerrar o cambiar de acta invalida las respuestas visuales pendientes. Una respuesta anterior no sustituye la firma ni imprime otro documento.
- La impresión manual del navegador con el acta abierta y pendiente muestra un aviso en lugar del acta incompleta.
- Se conservan firmas físicas explícitas, firmas digitales, textos de firma existentes y ausencia de firma confirmada. Un valor vacío no se presenta como firmado por QR.

No cambia el guardado de entregas ni las firmas existentes. No requiere SQL, migraciones, modificaciones de permisos ni cambios en cantidades.

## Medición real de lectura

Se ejecutó el código local conectado a la base real desde un navegador temporal, con escrituras bloqueadas salvo la consulta de versión de guías, que es una función de lectura. No se guardaron datos personales ni imágenes en los resultados de medición.

| Medición | Antes | Implementación |
| --- | ---: | ---: |
| Actas | 5.387 | 5.387 |
| Páginas de actas | 11 | 11 |
| JSON de actas | 16.964.592 bytes | 1.758.141 bytes |
| Tiempo hasta aviso de listo | 17.344 ms | 8.764 ms |

La implementación hizo cinco comprobaciones de compatibilidad porque la base real no tiene las columnas opcionales. Una consulta posterior de un acta física tardó 262 ms y descargó 85 bytes; la impresión quedó habilitada tras la confirmación. Todas estas operaciones fueron de lectura.

Son mediciones individuales de esta conexión y equipo; no garantizan tiempos de producción. Los tamaños son JSON descomprimido, no una estimación del tráfico comprimido de red.

## Verificación

Pruebas de repositorio cubren paginación, metadatos completos, selección sin firma, compatibilidad con columnas antiguas, consultas individuales, caché, peticiones simultáneas, reintentos y respuestas incompletas.

Las pruebas de navegador cubren firmas digitales y físicas, descarga lenta, error de red, imagen inválida, impresión, cierre y cambio de acta con respuestas pendientes, ausencia de firma confirmada y exportación sin descargar imágenes. Se conserva además la regresión de guías, devoluciones, analíticas e inicio.
