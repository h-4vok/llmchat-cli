# Auditoría y verificación del MCP — 2026-10-02

## Resultado

El wrapper stdio de #84 funciona con el CLI y Codex de esta PC. Un pedido natural
puede seleccionar el proveedor sin nombrar LLMChat. Se verificaron llamadas
completas con `demo`, envío de contexto de un issue y preparación de un borrador.
Las consultas reales a Gemini seleccionaron la herramienta correcta, pero
terminaron con un error explícito de autenticación. **No se obtuvo una respuesta
de Gemini.** Falta iniciar sesión en el perfil dedicado de LLMChat y repetir ese
último recorrido. No se publicaron cambios en GitHub.

## Trabajo heredado y cambios

El commit `2c4d4cb` preserva el trabajo que ya existía antes de esta auditoría:
paquete separado con SDK MCP, cuatro herramientas, subprocess JSONL, comandos
administrativos del CLI, instalación global, smoke y pruebas iniciales. Su
mensaje detalla lo observado y las dudas pendientes; permite rollback.

La arquitectura era adecuada para el objetivo, pero había defectos observables:

- Faltaban descripciones que relacionaran Gemini con `chat` y explicaran cómo
  transferir contexto. Se añadieron metadatos y la skill `consult-llm`.
- La ejecución de shims npm en Windows podía alterar comillas, saltos de línea y
  caracteres del prompt. Ahora se resuelve la entrada JavaScript y se usa Node
  sin shell; `--` protege consultas cuyo texto parece una opción del CLI.
- Las operaciones administrativas y sus fallos no siempre producían stdout
  estructurado. Se conserva JSONL v1 y se separan los mensajes humanos.
- Los errores terminales con exit no cero perdían información, y los formatos
  seleccionados no se renderizaban. Ahora se conserva el fallo canónico,
  actividad y respuesta parcial, y se ofrecen text/JSON/JSONL/YAML.
- El timeout exterior de 120 segundos era menor que el de ejecución del CLI de
  180 segundos. Ahora el wrapper permite 300 y el host usa 330.
- Los fragmentos UTF-8 podían corromper texto. stdout y stderr se decodifican
  como streams antes de interpretar JSONL.
- En esta PC, PowerShell 5 heredaba `PSModulePath` de PowerShell 7 y no encontraba
  `Get-Acl`. Se elimina esa variable sólo para ese proceso hijo.
- El primer ensayo real de Gemini emitió un diagnóstico de sesión desconocida,
  pero mantuvo un navegador oculto abierto hasta el timeout. Ahora ese probe se
  cierra. También se comprueban coincidencias visibles de los controles de login,
  para que una primera coincidencia oculta no tape otra visible.

No se reemplazó el endpoint anterior `llmchat mcp`: sigue exponiendo `ask_llm`.
El wrapper expone `chat`, `health`, `auth` y `config`, como pide
[#84](https://github.com/h-4vok/llmchat-cli/issues/84). El cierre de
[#69](https://github.com/h-4vok/llmchat-cli/issues/69#issuecomment-5381900040)
explica por qué la descripción original de los issues no coincide con ese
endpoint anterior. La decisión de esta rama es conservarlo compatible y definir
las cuatro herramientas en el paquete independiente.

[#85](https://github.com/h-4vok/llmchat-cli/issues/85) propone Streamable HTTP con
mTLS. Fue analizado, pero **no está implementado**: es un transporte separado,
innecesario para el objetivo local. Sus decisiones pendientes y criterios están
en [mcp-provider-workflow.md](mcp-provider-workflow.md).

## Integración de esta PC

`codex mcp get llmchat-local` confirma: habilitado, stdio, comando
`llmchat-mcp-wrapper`, sin argumentos y timeout de 330 segundos. Los enlaces npm
globales apuntan a este checkout y a `packages/mcp-wrapper`. Por eso cambiar de
rama o recompilar el checkout cambia el CLI que utiliza la instalación local.

Se añadió `tool_timeout_sec = 330` al bloque existente del servidor. La copia
anterior de configuración está en
`~/.codex/config.toml.llmchat-backup-ca334dd430a746558d5d777bf6288833`.
La skill versionada en `.agents/skills/consult-llm` también se instaló en
`~/.codex/skills/consult-llm`; ambas copias tienen el mismo SHA-256. Así puede
descubrirse fuera del repositorio. No se modificó el modelo ni la política global
de aprobaciones.

Los ejercicios de terminal usaron Codex CLI 0.155.0 y `gpt-6-sol` con razonamiento
high. El CLI rechazó `gpt-6.1-sol` para esta cuenta antes de ejecutar herramientas;
ese intento no prueba el MCP. El modelo de esta conversación y la configuración
global quedaron iguales. Las sesiones fueron efímeras y se ejecutaron desde un
directorio temporal, sin instrucciones de proyecto de este checkout.

Para los ejercicios se aprobaron las herramientas de `llmchat-local` mediante
una opción de esa única ejecución. El modo read-only del CLI bloqueó la lectura
de la skill con PowerShell. La prueba de lectura del issue y la del comando
registrado se ejecutaron con permisos locales como los de esta tarea; los
pedidos exigían análisis/borrador sin publicar. No se cambió la configuración
global para resolver ese bloqueo.

## Evidencia

`npm run check` pasó tanto en la implementación como en la revisión independiente:
342 pruebas, 341 aprobadas, una omitida porque Windows no permitió crear el
enlace simbólico nativo. Formato y lint pasaron; cobertura de statements,
branches, functions y lines del código `src/`: 100%. El gate independiente dio
**PASS** antes de los ejercicios manuales. Las pruebas automáticas usan procesos
falsos o demo, almacenamiento temporal y ninguna sesión real de proveedor.

La revisión corrigió también dos pruebas que leían configuración de la PC. Una
configuración externa temporal malformada reproducía el fallo antes; las mismas
20 pruebas pasaron después del aislamiento. El cliente MCP del test que invoca
el CLI real usa 330 segundos, coherente con el límite exterior del wrapper.

| Ejercicio manual                              | Llamada comprobada                                                         | Resultado                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Smoke del comando global                      | Descubre los cuatro tools; `chat`, demo                                    | `status: success`; `Demo response: decí exactamente MCP ok`                                   |
| Pedido natural a demo fuera del repo          | `llmchat-local.chat`, provider demo, prompt `LLMCHAT_DEMO_OK`              | Codex devolvió `Demo response: LLMCHAT_DEMO_OK`                                               |
| Mismo pedido con la configuración global real | Comando registrado, sin sustituirlo por Node/ruta interna                  | Misma llamada y respuesta satisfactorias                                                      |
| Analizar el issue real con demo               | Prompt de 4522 caracteres con título, cuerpo y comentario de #84           | Eco completo; Codex redactó dos criterios y los atribuyó a su propio borrador                 |
| «Preguntale a Gemini…»                        | `chat`, provider gemini, prompt correcto                                   | Fallo estructurado de autenticación; Codex informó el problema                                |
| «Usá Gemini para refinar el issue 84»         | Codex leyó #84/comentarios con `gh`, contrastó #69 y envió 5044 caracteres | Mismo fallo de sesión; borrador propio claramente identificado, sin atribución falsa a Gemini |

Los registros JSONL locales están en `reports/`, que Git ignora:
`demo-natural-final`, `demo-registered-final`, `demo-issue-final`,
`gemini-natural-final` y `gemini-issue-final`, cada uno con extensión `.jsonl`.
`manual-evidence-summary.json` resume las llamadas verificadas. Se comprobó en
los registros el proveedor, el prompt con contexto, el estado estructurado, la
respuesta exacta de demo, la lectura de skill/issue y la ausencia de comandos
`gh issue edit/comment/close`. No se versionan logs ni capturas del proveedor.

## Qué queda pendiente

Ejecutar manualmente `llmchat auth gemini`, iniciar sesión y cerrar el navegador
cuando corresponda. Luego abrir un chat nuevo o recargar MCP en Codex y pedir:

```text
Preguntale a Gemini: respondé únicamente LLMCHAT_GEMINI_OK.
```

La evidencia necesaria es una llamada `chat` completada, `status: success`, texto
real de Gemini y uso de ese texto por Codex. `health` sólo comprueba los controles
de la página: ya devolvió healthy en una página de invitado, por lo que no sirve
como prueba de autenticación.

Hay una deuda del runtime anterior: una terminación forzada puede dejar un
directorio de lease vacío. Ocurrió al abortar el ensayo inicial. Se retiró sólo
ese lease después de comprobar que no había procesos usando el CLI/perfil y que
estaba vacío. El allocator aún no recupera automáticamente leases abandonados;
no se debe borrar uno mientras el perfil esté en uso. Esto merece un cambio
separado con pruebas de procesos interrumpidos.

El descubrimiento por lenguaje natural depende del modelo; las descripciones y
la skill lo orientan, y los ejercicios prueban estos casos concretos. La web de
Gemini conserva su dependencia de la UI y de una sesión autenticada. DeepSeek y
Claude requieren nuevos adaptadores y actualizar capacidades/descripciones;
esta rama no los anuncia como disponibles.
