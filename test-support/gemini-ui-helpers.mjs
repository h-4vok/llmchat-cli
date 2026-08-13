export function createChoice(calls, text, visible, enabled, select) {
  return {
    async visible() {
      return visible;
    },
    async click() {
      calls.push(['click', `choice:${text}`]);
      select();
    },
    async enabled() {
      return enabled;
    },
    async active() {
      return false;
    },
  };
}

export function createArtifactPort(artifacts) {
  return {
    async saveDiagnostic(content) {
      artifacts.push(['diagnostic', content]);
    },
    async saveScreenshot(content) {
      artifacts.push(['screenshot', [...content]]);
    },
  };
}
