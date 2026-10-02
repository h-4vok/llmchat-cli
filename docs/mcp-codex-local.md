# Usar el MCP local de `llmchat-cli` desde Codex

Esta guía conecta Codex con el wrapper MCP local del repositorio. El wrapper es un servidor MCP stdio y ejecuta un proceso `llmchat` nuevo para cada llamada.

```text
Codex → llmchat-mcp-wrapper → llmchat CLI → provider/browser
```

## Requisitos

- Node.js 22 o superior.
- Este checkout y sus dependencias (`npm install`).
- Para la primera prueba, usar el provider `demo`; no requiere credenciales ni navegador.

## Preparar el checkout

Desde la raíz:

```text
npm install
npm run build
```

El wrapper se instala como comando global en el siguiente paso; Codex no necesita conocer rutas internas del checkout.

## Registrar el servidor en Codex

En la configuración de MCP de Codex agregá un servidor local `stdio`:

- Nombre: `llmchat-local`
- Command: `llmchat-mcp-wrapper`
- Arguments: ninguno
- Working directory: dejar vacío
- Tool timeout: 330 segundos (`tool_timeout_sec = 330` en TOML).

Antes de abrir Codex, ejecutá desde el checkout:

```text
npm run install:global
```

Ese comando instala globalmente ambos comandos: `llmchat` y `llmchat-mcp-wrapper`. El wrapper usa `llmchat` desde el `PATH` por defecto. No hace falta configurar `LLMCHAT_EXECUTABLE`; usalo sólo para una instalación alternativa.

## Verificar la conexión

### Smoke test desde la terminal

Si no querés reiniciar Codex todavía, probá el wrapper desde la raíz del checkout:

```text
npm run install:global
npm run test:mcp:local
```

El script inicia un cliente MCP temporal, levanta `llmchat-mcp-wrapper`, descubre los cuatro tools y ejecuta un `chat` con `demo`. Termina automáticamente. La salida esperada incluye:

```text
TOOLS=chat,health,auth,config
RESULT=...Demo response: decí exactamente MCP ok...
```

Recargá los servidores MCP en Codex. Debe anunciar estos tools: `chat`, `health`, `auth` y `config`.

Probalo con: `Consultá al provider demo y preguntale "decí exactamente MCP ok".`

La respuesta esperada contiene `Demo response: decí exactamente MCP ok`.

## Qué ocurre durante una llamada

Para `chat`, el wrapper ejecuta algo equivalente a `llmchat chat --provider demo --output jsonl -- "el prompt"`. Lee stdout como JSONL versionado, conserva stderr para diagnósticos y devuelve el resultado como MCP. Los cuatro tools usan el mismo boundary.

La invocación real coloca las opciones primero y el prompt después de `--`,
para que un texto como `--help` siga siendo una consulta. El límite externo del
wrapper es de 300 segundos, para permitir los 180 segundos de ejecución del CLI
más la preparación y el cierre de la sesión. Configurá el host con un límite
mayor para que no interrumpa antes al wrapper.

El wrapper no importa Playwright ni Gemini ni mantiene un daemon `llmchat`.
Cada llamada tiene un proceso propio. El CLI puede reutilizar la autenticación
guardada en el perfil de navegador dedicado de LLMChat; ese perfil no es el
perfil habitual del navegador del usuario. La conversación es temporal por
defecto. MCP no abre autenticación interactiva automáticamente.

En Windows resuelve el shim npm a su entrada JavaScript y ejecuta Node sin shell.
Esto conserva comillas, saltos de línea y caracteres especiales del prompt.
`LLMCHAT_EXECUTABLE` también puede apuntar directamente a `dist/cli.js` o a un
ejecutable nativo. No se ejecutan wrappers `.cmd/.bat` arbitrarios.

## Consultas naturales y contexto de issues

Con Gemini autenticado, podés decir `Preguntale a Gemini qué riesgos ves en este
issue` sin mencionar LLMChat. El tool `chat` describe esa capacidad. La skill
[consult-llm](../.agents/skills/consult-llm/SKILL.md) se descubre en este checkout
y enseña a preparar el contexto y a usar la respuesta para la acción pedida.

Para usar la skill fuera de este repositorio, copiá esa carpeta a
`~/.codex/skills/consult-llm` y abrí una sesión nueva de Codex. No hace falta
modificar instrucciones globales ni nombrar la skill en cada pedido.

El flujo y la relación entre los issues 84 y 85 están explicados en
[mcp-provider-workflow.md](mcp-provider-workflow.md).

## Troubleshooting

- `Unable to start llmchat`: verificá que `llmchat` esté en el `PATH` del proceso de Codex; podés definir `LLMCHAT_EXECUTABLE` para sobrescribirlo.
- No aparecen tools: confirmá que `llmchat-mcp-wrapper` esté en el `PATH`, ejecutá `npm run install:global` y recargá MCP.
- Error de schema/JSONL: asegurate de apuntar al CLI de este checkout y no a una instalación antigua.
- Para Gemini, autenticá manualmente con `llmchat auth gemini`. `llmchat health gemini` verifica los controles de la página; una página saludable no demuestra que la sesión esté autenticada. La comprobación completa es una consulta que devuelva una respuesta del proveedor.

No compartas credenciales, perfiles, logs ni screenshots en issues o reportes.
