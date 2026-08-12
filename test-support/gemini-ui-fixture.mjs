export function geminiUiFixture(options = {}) {
  const settings = {
    modelVisible: true,
    modelOpenerVisible: true,
    choiceThrows: false,
    composeFirst: false,
    silentFirst: false,
    url: 'https://gemini.google.com/app',
    ...options,
  };
  const calls = [];
  let sent = false;
  let waits = 0;
  const element = createElement(
    calls,
    () => sent,
    (value) => (sent = value),
  );
  const elements = createElements(settings, element, () => waits);
  const artifacts = [];
  return {
    calls,
    artifacts,
    page: createPage(settings, calls, elements, () => (waits += 1)),
    artifactPort: createArtifactPort(artifacts),
  };
}

function createElement(calls, sent, setSent) {
  return (name, visible, text = '') => ({
    async visible() {
      return typeof visible === 'function' ? visible() : visible;
    },
    async click() {
      calls.push(['click', name]);
      if (name === 'send') setSent(true);
    },
    async fill(value) {
      calls.push(['fill', name, value]);
    },
    async innerText() {
      calls.push(['innerText', name]);
      return text;
    },
    sent,
  });
}

function createElements(settings, element, waits) {
  const delayed = settings.composeFirst || settings.silentFirst;
  return {
    blocked: element('blocked', false),
    captcha: element('captcha', false),
    composer: element('composer', settings.missing !== 'composer'),
    error: element(
      'error',
      () => elementSent(element) && Boolean(settings.errorText),
      settings.errorText,
    ),
    model: element('model', settings.modelOpenerVisible),
    login: element('login', false),
    response: element(
      'response',
      () => elementSent(element) && !settings.errorText && (!delayed || waits() > 0),
      'plain **markdown**',
    ),
    send: element('send', settings.missing !== 'send'),
    stop: element('stop', () => elementSent(element) && settings.composeFirst && waits() === 0),
  };
}

function elementSent(element) {
  return element('probe', false).sent();
}

function createPage(settings, calls, elements, incrementWait) {
  return {
    async goto(received) {
      calls.push(['goto', received]);
    },
    element(name) {
      return elements[name];
    },
    exactText(text) {
      calls.push(['exact-model', text]);
      const choice = createChoice(calls, text, settings.modelVisible);
      if (settings.choiceThrows) choice.click = () => Promise.reject(new Error('menu changed'));
      return choice;
    },
    async wait() {
      incrementWait();
    },
    closed: () => false,
    currentUrl: () => settings.url,
    async screenshot() {
      calls.push(['screenshot']);
      return new Uint8Array([1, 2]);
    },
    async close() {
      calls.push(['close-page']);
    },
  };
}

function createChoice(calls, text, visible) {
  return {
    async visible() {
      return visible;
    },
    async click() {
      calls.push(['click', `choice:${text}`]);
    },
  };
}

function createArtifactPort(artifacts) {
  return {
    async saveDiagnostic(content) {
      artifacts.push(['diagnostic', content]);
    },
    async saveScreenshot(content) {
      artifacts.push(['screenshot', [...content]]);
    },
  };
}
