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

Probalo con: `Usá el MCP llmchat-local y llamá a chat con provider demo y prompt "decí exactamente MCP ok".`

La respuesta esperada contiene `Demo response: decí exactamente MCP ok`.

## Qué ocurre durante una llamada

Para `chat`, el wrapper ejecuta algo equivalente a `llmchat chat "el prompt" --provider demo --output jsonl`. Lee stdout como JSONL versionado, conserva stderr para diagnósticos y devuelve el resultado como MCP. Los cuatro tools usan el mismo boundary.

El wrapper no importa Playwright ni Gemini, no mantiene un daemon `llmchat`, no comparte sesiones y no abre autenticación automáticamente desde MCP.

## Troubleshooting

- `Unable to start llmchat`: verificá que `llmchat` esté en el `PATH` del proceso de Codex; podés definir `LLMCHAT_EXECUTABLE` para sobrescribirlo.
- No aparecen tools: confirmá que `llmchat-mcp-wrapper` esté en el `PATH`, ejecutá `npm run install:global` y recargá MCP.
- Error de schema/JSONL: asegurate de apuntar al CLI de este checkout y no a una instalación antigua.
- Para Gemini, autenticá manualmente con `llmchat auth gemini` y verificá con `llmchat health gemini`.

No compartas credenciales, perfiles, logs ni screenshots en issues o reportes.
