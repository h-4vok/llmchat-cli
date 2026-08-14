export function choiceVisible(settings, text, isFallback, waits) {
  if (text === 'Extended thinking')
    return settings.reasoningVisible && settings.reasoningVisibleAfter <= waits();
  return isFallback ? settings.fallbackVisible : settings.modelVisible;
}
