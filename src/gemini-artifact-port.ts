import type { GeminiArtifactPort } from './gemini-ui-conversation.js';
import { saveDiagnostic, saveScreenshot } from './secure-storage.js';

type ArtifactStorage = {
  saveDiagnostic: typeof saveDiagnostic;
  saveScreenshot: typeof saveScreenshot;
};

export function geminiArtifactPort(options: ArtifactStorage): GeminiArtifactPort {
  return {
    async saveDiagnostic(content: string) {
      options.saveDiagnostic('gemini', content);
    },
    async saveScreenshot(content: Uint8Array) {
      options.saveScreenshot('gemini', content);
    },
  };
}
