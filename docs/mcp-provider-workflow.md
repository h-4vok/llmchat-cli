# Consultar proveedores desde Codex

## Resultado buscado

Un usuario puede decir «Preguntale a Gemini…» o «Usá Gemini para analizar este
issue» sin conocer el nombre LLMChat. Codex selecciona el MCP, prepara una
consulta con el contexto necesario y usa la respuesta para cumplir el pedido.
La selección la decide el modelo de Codex a partir de las descripciones y las
skills; no es un parser de frases ni una garantía de que todo pedido active una
herramienta. Debe verificarse con pedidos reales y evidencia de las llamadas.

## Componentes y responsabilidades

```text
Usuario → Codex → MCP stdio → llmchat CLI → Gemini web
             ↑                              ↓
             └──────── respuesta MCP ────────┘
```

Codex obtiene archivos e issues, decide qué contexto enviar, evalúa la respuesta
y aplica las acciones pedidas. El MCP no hereda la conversación y no tiene una
integración con GitHub. Gemini recibe únicamente el prompt enviado; una URL o
«este issue» sin su contenido no le transfiere el contexto.

El wrapper es un paquete separado que usa el SDK MCP y llama al CLI en un
proceso nuevo. No importa Playwright ni módulos de proveedores. Lee JSONL v1,
conserva actividad, respuesta y errores y devuelve `structuredContent`; el
contenido de texto puede elegirse como text, JSON, JSONL o YAML. El CLI conserva
la responsabilidad de ejecutar y autenticar proveedores y de producir el
contrato canónico. El wrapper usa `LLMCHAT_NON_INTERACTIVE=1`; una sesión ausente
devuelve instrucciones para autenticar manualmente.

Un proceso nuevo no borra la autenticación: el CLI conserva un perfil de
navegador dedicado por proveedor. El wrapper no mantiene estado en memoria
entre llamadas. Las conversaciones son temporales por defecto; compartir la
autenticación no transfiere el contexto de una consulta a la siguiente.

Las consultas MCP y los chequeos `health` ocultan el navegador por defecto:
el wrapper agrega `--headless` al CLI y `ask_llm` aplica la misma política.
Sólo un pedido explícito de mostrarlo justifica `headless: false`. `auth`
comprueba la sesión siempre oculto; el login interactivo se hace en una terminal.
El CLI directo mantiene el navegador visible salvo que se pase `--headless`.
Si aparece un login, CAPTCHA o bloqueo durante una consulta oculta, se devuelve
un error accionable y se cierra el navegador, sin esperar intervención ni
reenviar el prompt. Mostrar la página requiere un pedido explícito del usuario.

Los modelos pedidos se respetan sin fallback: «Flash» nunca elige «Flash Lite».
El nombre completo debe coincidir con la etiqueta del menú. Los alias Flash y
Flash Lite admiten una versión visible única, distinguiendo ambas variantes;
si hay varias versiones coincidentes, se requiere un nombre completo. Un modelo
ausente, deshabilitado o ambiguo falla antes de escribir o enviar el prompt.
Después de seleccionar, se verifica el botón; si abrevia el nombre y omite la
versión, se comprueba la opción marcada en el menú. El espacio de presentación
alrededor de las etiquetas no cambia la identidad del modelo.

Hay dos endpoints locales diferentes:

| Endpoint                                     | Herramientas                       | Ejecución                   |
| -------------------------------------------- | ---------------------------------- | --------------------------- |
| `llmchat mcp` (implementación anterior, #69) | `ask_llm`                          | Runtime dentro del servidor |
| `llmchat-mcp-wrapper` (#84)                  | `chat`, `health`, `auth`, `config` | Un CLI hijo por llamada     |

Los issues 84 y 85 describen cuatro herramientas como si #69 ya las ofreciera.
El código de #69 realmente ofrece `ask_llm`. La rama mantiene ese endpoint
compatible y define las cuatro herramientas en el wrapper. No se deben
confundir sus esquemas ni esperar que uno llame al otro.

## Flujo humano

«Usá Gemini para analizar el issue 84»: Codex lee título, cuerpo y comentarios
relevantes; prepara un prompt con esos datos, el contexto técnico y la pregunta;
llama `chat(provider: gemini, prompt: …)`; comprueba el estado y entrega las
conclusiones útiles, atribuidas a Gemini.

«Usá Gemini para refinar el issue 25 y actualizalo»: Codex hace la misma consulta,
evalúa la propuesta, conserva el alcance del issue y actualiza GitHub con sus
propias herramientas. Puede usar `gh issue edit --body-file` para preservar
saltos de línea. La respuesta de Gemini es material de trabajo; no hace falta
volcarla completa en la respuesta final. El usuario recibe el enlace y los
cambios. Pedir sólo un análisis o un borrador no autoriza publicar una edición.

Las descripciones del wrapper permiten descubrir la consulta directamente.
La skill [consult-llm](../.agents/skills/consult-llm/SKILL.md) añade el flujo con
contexto y edición. Sus instrucciones también sirven con el endpoint anterior.
Esto sigue la distinción de OpenAI entre [herramientas que describen la acción](https://developers.openai.com/plugins/plan/tools)
y [skills que organizan el flujo](https://developers.openai.com/plugins/concepts/skills).

## Alcance de los issues

[#84](https://github.com/h-4vok/llmchat-cli/issues/84) corresponde al wrapper de
esta rama. El trabajo heredado ya implementaba su estructura, pero necesitaba
corregir argumentos en Windows, salida administrativa, conservación de errores,
formatos, validación y descubrimiento. El commit `2c4d4cb` preserva esa versión
original para comparación y rollback.

[#85](https://github.com/h-4vok/llmchat-cli/issues/85) es otro paquete: un endpoint
Streamable HTTP con mTLS obligatorio. No está implementado en esta rama y no es
necesario para consultar Gemini desde Codex local. Su implementación futura debe
reutilizar el contrato y las definiciones de herramientas del wrapper; el
transporte y la verificación TLS son responsabilidades separadas.

Antes de implementarlo, su especificación debe fijar: certificado, clave y CA
obligatorios; rechazo antes de escuchar si son inválidos; cliente autorizado en
cada conexión; sesiones HTTP del SDK y cancelación; cierre que termine hijos;
y pruebas locales con certificados de confianza, ausentes y no confiables.
El criterio «sin persistencia/multisesión» necesita distinguir las sesiones del
protocolo MCP de las conversaciones del proveedor. No se debe abrir un endpoint
HTTP para solucionar un problema de descubrimiento de herramientas.

DeepSeek y Claude siguen pendientes. Agregarlos requerirá adaptadores del CLI,
capacidades y pruebas de contrato, y actualizar los metadatos y la skill. El
wrapper acepta un ID de proveedor como dato y no duplica su implementación.

## Verificación

Las pruebas automáticas son offline: procesos falsos, transportes MCP en memoria
y el provider demo con almacenamiento temporal aislado. Comprueban el texto
multilínea, los cuatro tools, configuración, errores, actividad, formatos y
cancelación. `npm run check` sigue siendo el gate obligatorio.

Las sesiones reales de Codex/Gemini son ejercicios manuales separados y usan la
instalación de esta PC. Una prueba satisfactoria necesita mostrar: provider
correcto, prompt con contexto, llamada MCP completada, estado estructurado
success y uso de la respuesta. Que Codex diga «consulté Gemini» sin una llamada
completada no demuestra que el flujo funcionó.

La auditoría y las llamadas comprobadas de esta PC están registradas en
[mcp-verification-2026-10-02.md](mcp-verification-2026-10-02.md), con la distinción
entre el recorrido positivo de demo y el login pendiente de Gemini.
