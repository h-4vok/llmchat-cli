export function geminiUiFixture(options = {}) {
  const settings = {
    modelVisible: true,
    activeModel: 'Flash',
    reasoning: 'Standard',
    reasoningVisible: true,
    reasoningVisibleAfter: 0,
    reasoningStuck: false,
    buttonExtended: undefined,
    modelEnabled: true,
    fallbackVisible: true,
    fallbackEnabled: true,
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
    page: createPage(
      settings,
      calls,
      elements,
      () => (waits += 1),
      () => waits,
    ),
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
    async enabled() {
      return true;
    },
    async fill(value) {
      calls.push(['fill', name, value]);
    },
    async innerText() {
      calls.push(['innerText', name]);
      return typeof text === 'function' ? text() : text;
    },
    async active() {
      calls.push(['active', name]);
      return false;
    },
    sent,
  });
}

function createElements(settings, element, waits) {
  let activeModel = settings.activeModel;
  let reasoning = settings.reasoning;
  const delayed = settings.composeFirst || settings.silentFirst;
  return {
    temporaryChat: temporaryChatElement(settings, element),
    blocked: element('blocked', false),
    captcha: element('captcha', false),
    composer: element('composer', settings.missing !== 'composer'),
    error: element(
      'error',
      () => elementSent(element) && Boolean(settings.errorText),
      settings.errorText,
    ),
    model: element(
      'model',
      settings.modelOpenerVisible,
      () =>
        `${activeModel}${(settings.buttonExtended ?? (!settings.reasoningStuck && reasoning === 'Extended thinking')) ? ' Extended' : ''}`,
    ),
    login: element('login', false),
    response: element(
      'response',
      () => elementSent(element) && !settings.errorText && (!delayed || waits() > 0),
      'plain **markdown**',
    ),
    send: element('send', settings.missing !== 'send'),
    stop: element('stop', () => elementSent(element) && settings.composeFirst && waits() === 0),
    setActiveModel: (model) => (activeModel = model),
    setReasoning: () => {
      if (!settings.reasoningStuck)
        reasoning = reasoning === 'Extended thinking' ? 'Standard' : 'Extended thinking';
    },
    reasoningActive: () => reasoning === 'Extended thinking',
  };
}

function elementSent(element) {
  return element('probe', false).sent();
}

function createPage(settings, calls, elements, incrementWait, currentWaits) {
  return {
    async goto(received) {
      calls.push(['goto', received]);
    },
    element(name) {
      return elements[name];
    },
    exactText(text) {
      calls.push(['exact-model', text]);
      const isFallback = text === '3.5 Flash-Lite';
      const choice = createChoice(
        calls,
        text,
        choiceVisible(settings, text, isFallback, currentWaits),
        enabled(settings, isFallback),
        () =>
          text === 'Extended thinking' ? elements.setReasoning() : elements.setActiveModel(text),
      );
      choice.active = async () => text === 'Extended thinking' && elements.reasoningActive();
      if (settings.choiceThrows) choice.click = () => Promise.reject(new Error('menu changed'));
      return choice;
    },
    async wait() {
      incrementWait();
    },
    currentUrl: () => settings.url,
    closed: () => false,
    async screenshot() {
      calls.push(['screenshot']);
      return new Uint8Array([1, 2]);
    },
    async close() {
      calls.push(['close-page']);
    },
  };
}
const enabled = (settings, isFallback) =>
  isFallback ? settings.fallbackEnabled : settings.modelEnabled;
import { createArtifactPort, createChoice } from './gemini-ui-helpers.mjs';
import { choiceVisible } from './gemini-fixture-visibility.mjs';
import { temporaryChatElement } from './gemini-fixture-temporary-chat.mjs';
