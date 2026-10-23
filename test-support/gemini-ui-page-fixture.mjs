import { createGeminiChoiceStub } from './gemini-ui-helpers.mjs';
import { choiceVisible } from './gemini-fixture-visibility.mjs';

const reasoningLevels = ['Low', 'Medium', 'High'];

export function createGeminiPageStub({ settings, calls, elements, incrementWait, currentWaits }) {
  return {
    async goto(received) {
      calls.push(['goto', received]);
    },
    element: (name) => elements[name],
    exactText: (text) => createChoice({ settings, calls, elements, currentWaits }, text),
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

function createChoice(context, text) {
  context.calls.push(['exact-model', text]);
  const kind = optionKind(text);
  const choice = createGeminiChoiceStub({
    calls: context.calls,
    text,
    visible: optionVisible(context, kind, text),
    enabled: optionEnabled(context.settings, kind),
    select: () => selectOption(context.elements, kind, text),
  });
  if (context.settings.choiceThrows && kind !== 'reasoning-menu')
    choice.click = () => Promise.reject(new Error('menu changed'));
  choice.active = async () => kind === 'reasoning-level' && context.elements.reasoningActive(text);
  return choice;
}

function optionKind(text) {
  if (text === 'Thinking level') return 'reasoning-menu';
  if (reasoningLevels.includes(text)) return 'reasoning-level';
  return 'model';
}

function optionVisible(context, kind, text) {
  if (kind === 'reasoning-menu') return reasoningMenuVisible(context);
  if (kind === 'reasoning-level') return reasoningLevelVisible(context);
  return modelOptionVisible(context, text);
}

function reasoningMenuVisible({ elements, settings }) {
  return elements.menuOpen() && settings.reasoningVisible;
}

function reasoningLevelVisible({ elements, settings, currentWaits }) {
  return (
    elements.reasoningMenuOpen() &&
    settings.reasoningVisible &&
    settings.reasoningVisibleAfter <= currentWaits()
  );
}

function modelOptionVisible({ elements, settings, currentWaits }, text) {
  return elements.menuOpen() && choiceVisible(settings, text, currentWaits);
}

function optionEnabled(settings, kind) {
  return kind === 'model' ? settings.modelEnabled : settings.reasoningEnabled;
}

function selectOption(elements, kind, text) {
  if (kind === 'reasoning-menu') return elements.openReasoningMenu();
  if (kind === 'reasoning-level') return elements.selectReasoning(text);
  elements.setActiveModel(text);
  elements.closeMenus();
}
