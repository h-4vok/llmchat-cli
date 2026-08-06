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
