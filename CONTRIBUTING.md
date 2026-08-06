# Contribuir

Antes de abrir o actualizar un PR, ejecuta:

```text
npm install
npm run format:check
npm run build
npm test
```

Usa `npm run format` para aplicar Prettier. Prettier y EditorConfig definen el estilo compartido; los PR deben mantener el formato verificado y no cambiar el alcance funcional sin una issue asociada.
