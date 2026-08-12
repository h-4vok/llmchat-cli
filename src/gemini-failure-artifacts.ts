import { isDiagnosticCaptureAllowed } from './diagnostic-redaction-policy.js';
import { redactDiagnosticText } from './secret-redaction.js';
import { geminiConfig } from './config/gemini.js';
import { storageConfig } from './config/storage.js';

export interface GeminiArtifactPage {
  currentUrl(): string;
  screenshot(): Promise<Uint8Array>;
}

export interface GeminiArtifactPort {
  saveDiagnostic(content: string): Promise<void>;
  saveScreenshot(content: Uint8Array): Promise<void>;
}

export async function persistGeminiFailure(
  page: GeminiArtifactPage,
  artifacts: GeminiArtifactPort,
  error: Error,
): Promise<void> {
  const content = redactDiagnosticText(
    JSON.stringify({ provider: 'gemini', error: error.message }),
  );
  await artifacts.saveDiagnostic(content);
  if (!isProviderViewport(page.currentUrl())) return;
  await artifacts.saveScreenshot(await page.screenshot());
}

function isProviderViewport(url: string): boolean {
  return (
    url.startsWith(geminiConfig.providerUrlPrefix) &&
    isDiagnosticCaptureAllowed(storageConfig.capture.providerViewport)
  );
}
