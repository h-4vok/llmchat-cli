import { createArtifactPort } from './gemini-ui-helpers.mjs';
import { temporaryChatElement } from './gemini-fixture-temporary-chat.mjs';
import { createGeminiPageStub } from './gemini-ui-page-fixture.mjs';

export function geminiUiFixture(options = {}) {
  const settings = {
    modelVisible: true,
    modelVisibleAfter: 0,
    activeModel: '3.8 Flash',
    reasoning: 'Low',
    reasoningVisible: true,
    reasoningVisibleAfter: 0,
    reasoningEnabled: true,
    reasoningStuck: false,
    modelEnabled: true,
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
  const elements = createElements(settings, element, () => waits, calls);
  const artifacts = [];
  const result = {
    calls,
    artifacts,
    page: createGeminiPageStub({
      settings,
      calls,
      elements,
      incrementWait: () => (waits += 1),
      currentWaits: () => waits,
    }),
    artifactPort: createArtifactPort(artifacts),
  };
  result.page.modelOption = result.page.exactText;
  return result;
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
    async expanded() {
      return false;
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

function createElements(settings, element, waits, calls) {
  let activeModel = settings.activeModel;
  let reasoning = settings.reasoning;
  let modelMenuOpen = false;
  let reasoningMenuOpen = false;
  const delayed = settings.composeFirst || settings.silentFirst;
  const model = element('model', settings.modelOpenerVisible, () => activeModel);
  model.click = async () => {
    calls.push(['click', 'model']);
    modelMenuOpen = !modelMenuOpen;
    reasoningMenuOpen = false;
  };
  model.expanded = async () => modelMenuOpen;
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
    model,
    login: element('login', false),
    response: element(
      'response',
      () => elementSent(element) && !settings.errorText && (!delayed || waits() > 0),
      'plain **markdown**',
    ),
    send: element('send', settings.missing !== 'send'),
    stop: element('stop', () => elementSent(element) && settings.composeFirst && waits() === 0),
    setActiveModel: (model) => (activeModel = model),
    openReasoningMenu: () => (reasoningMenuOpen = true),
    closeMenus: () => {
      modelMenuOpen = false;
      reasoningMenuOpen = false;
    },
    selectReasoning: (level) => {
      if (!settings.reasoningStuck) reasoning = level;
      modelMenuOpen = false;
      reasoningMenuOpen = false;
    },
    reasoningActive: (level) => reasoning === level,
    menuOpen: () => modelMenuOpen,
    reasoningMenuOpen: () => reasoningMenuOpen,
  };
}

const elementSent = (element) => element('probe', false).sent();
