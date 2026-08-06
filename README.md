# llmchat-cli

CLI para enviar un prompt a un chat web autenticado mediante un perfil de navegador persistente, recuperar una única respuesta y escribirla en `stdout`; el progreso y los errores van a `stderr`.

## MVP

- Proveedor funcional: Gemini, mediante Chromium/Playwright y el perfil persistente `~/.llmchat-cli/profiles/gemini`.
- Un prompt por invocación; no se resuelven todavía login guiado, CAPTCHA, reintentos, configuración avanzada ni formatos alternativos.
- ChatGPT y Perplexity quedan para fases posteriores.

## Uso

```text
llmchat --provider gemini "Explica qué es una API en una frase"
llmchat --provider gemini --login
```

Requiere Node.js 20+ y Chromium instalado para Playwright. El login se realiza manualmente en la ventana del navegador y la sesión se conserva en el perfil local.

## Desarrollo

```text
npm install
npm run build
npm test
```

Este repositorio contiene sólo el esqueleto y la primera ruta Gemini end-to-end. Las decisiones pendientes están registradas como issues de GitHub.

## Loop engineering v1

La especificación canónica es la [issue #13](https://github.com/h-4vok/llmchat-cli/issues/13). El dispatcher manual se ejecuta con `npm run loop -- --list`, `npm run loop -- --status` o `npm run loop`. Copia `loop.config.json.example` a `loop.config.json` para configurar comandos de worker/revisión/QA. El estado local vive en `.llmchat/state.json` y nunca se versiona.

El flujo es deliberadamente secuencial: etiqueta `Automation Ready` → reclamo visible → worker → PR a `staging` → Staff/adversarial → QA/SDET → smoke tests → listo para merge humano. No hay merge automático a `main`, worktrees ni paralelismo. Si staging está rojo, el dispatcher se pausa y el rol Triage debe reparar y marcar `stagingGreen` en el estado antes de reanudar.

Roles y procedimientos operativos: [`docs/loop-engineering-v1.md`](docs/loop-engineering-v1.md), [`docs/roles/`](docs/roles/).
