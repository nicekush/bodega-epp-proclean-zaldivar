# Optimización conservadora de la carga inicial

Fecha: 27 de octubre de 2026.

Este documento describe la primera etapa. La optimización posterior de firmas está documentada en [carga-firmas-actas.md](carga-firmas-actas.md).

## Alcance

Se mantienen todas las consultas, campos, firmas, páginas del historial, reglas de negocio y fallbacks existentes. No requiere SQL ni cambios en datos o permisos.

`initDatabase` distribuye sus cargas independientes entre tres cargadores. Las páginas de cada tabla conservan su orden y las devoluciones se siguen cargando después de las actas. La consulta conjunta de catálogos y configuración de guías puede llevar el total a cuatro peticiones simultáneas.

El arranque espera todos los cargadores antes de preparar formularios y mostrar el aviso de carga completa. Si falla una consulta obligatoria, deja de iniciar cargadores pendientes y espera los que ya comenzaron antes de propagar el error. No muestra éxito ni renderiza el inventario parcial como resultado del arranque fallido.

La inicialización visual de guías reutiliza la carga confirmada por `initDatabase`. Conserva un reintento para guías o configuración que no pudieron confirmarse y mantiene la recarga por defecto cuando se inicializa de manera independiente. Los mecanismos explícitos de actualización continúan funcionando.

## Comprobación de la mejora

El recorrido normal con una página por tabla pasa de 21 a 17 peticiones, eliminando la segunda lectura de guías, catálogos, configuración y versión. Con tablas mayores, se conservan las páginas adicionales necesarias.

Se comparó el arranque anterior del commit `65702df` con el nuevo, ejecutando sus funciones reales sobre respuestas ficticias vacías, con una demora de 30 ms por petición y renderizado simulado:

| Versión | Peticiones | Tres ejecuciones | Promedio aproximado |
| --- | ---: | --- | ---: |
| Anterior | 21 | 631, 589 y 582 ms | 601 ms |
| Optimizada | 17 | 202, 197 y 186 ms | 195 ms |

Esta simulación mide la organización de las esperas; no predice el tiempo real de producción. No incluye transferencia de historiales, firmas, procesamiento del navegador ni latencia real de Supabase.

## Verificación

Las pruebas del arranque ejecutan el controlador, los cargadores y los repositorios reales con respuestas simuladas. Comprueban datos completos y firmas, una sola lectura normal de guías, paginación, concurrencia limitada, espera de consultas lentas, errores en cada tabla obligatoria, recuperación de errores transitorios de guías, fallbacks y bloqueo de saldos netos sin devoluciones confirmadas.

Las pruebas de navegador verifican espera del historial lento y rechazo de consultas obligatorias, además de la regresión de guías y devoluciones. No utilizan datos de producción.

## Fuera de esta etapa

No se implementan carga de firmas bajo demanda, recorte de históricos, nuevos cachés, cambios de índices ni carga por secciones. Esas modificaciones requieren una evaluación separada de sus dependencias.
