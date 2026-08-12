import { createGeminiUiConversation } from '../dist/gemini-ui-conversation.js';

export function geminiInterventionFixture(initialIntervention, postSendIntervention) {
  const calls = [];
  const notifications = [];
  let intervention = initialIntervention;
  let releaseWait = () => {};
  let closed = false;
  let sent = false;
  const visibleNames = () => {
    const names = new Set(['composer', 'send']);
    if (intervention) names.add(intervention);
    if (sent) names.add('response');
    return names;
  };
  const element = (name) => ({
    visible: async () => visibleNames().has(name),
    click: async () => {
      calls.push(['click', name]);
      if (name === 'send') {
        sent = true;
        intervention = postSendIntervention;
      }
    },
    fill: async (value) => calls.push(['fill', name, value]),
    innerText: async () => 'response',
  });
  const page = {
    goto: async () => calls.push(['goto']),
    element,
    exactText: () => element('choice'),
    wait: () => new Promise((resolve) => (releaseWait = resolve)),
    closed: () => closed,
    currentUrl: () =>
      intervention === 'login-url'
        ? 'https://accounts.google.com/ServiceLogin'
        : 'https://gemini.google.com/app',
    screenshot: async () => new Uint8Array(),
    close: async () => calls.push(['close']),
  };
  return {
    calls,
    notifications,
    conversation: createGeminiUiConversation(
      page,
      { saveDiagnostic, saveScreenshot },
      { send: async (notification) => notifications.push(notification) },
    ),
    resolve() {
      intervention = undefined;
      releaseWait();
    },
    advance: () => releaseWait(),
    cancel() {
      closed = true;
      releaseWait();
    },
  };
}

async function saveDiagnostic() {}
async function saveScreenshot() {}
