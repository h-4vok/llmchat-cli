# Operación del loop engineering v1

## Ejecución

1. Product Lead completa requisitos, criterios, riesgos y no-alcance; sólo después aplica `Automation Ready`.
2. Dispatcher ejecuta manualmente `npm run loop`, toma la issue abierta de menor número y escribe un estado local. Nunca arranca otra tarea activa.
3. El Worker crea una rama desde `staging`, implementa la issue en el checkout local y abre un PR cuyo base es `staging`.
4. Staff Reviewer publica un comentario adversarial separado. QA/SDET publica otro comentario con pruebas y smoke tests. Las observaciones vuelven al Worker y aumentan `reviewRound`.
5. Sólo cuando ambos están limpios y smoke pasa se marca `ready_for_human_merge`. Una persona decide el merge; `main` queda protegido del loop.

## Recuperación

Un fallo de staging establece `stagingGreen: false`, estado `blocked` y pausa el dispatcher. Triage crea o prioriza una reparación, publica diagnóstico y ejecuta `stagingHealthCommand`. Sólo tras éxito cambia el estado a verde y se reanuda.

## Conjuntos multi-issue

Para un conjunto, cree `integration/<identificador>` desde `staging`, asocie cada issue en comentarios y abra un PR único a `staging`. Se conserva la secuencia y una sola tarea activa; no se mezclan ramas ni se hace merge automático.

## Configuración y extensiones

`loop.config.json` permite sustituir comandos de worker Codex, revisión Staff, QA, smoke y salud de staging. El estado puede migrarse a un almacén remoto y los comandos a adaptadores API en el futuro, sin cambiar la política de gating.
