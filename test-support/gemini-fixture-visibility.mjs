export function choiceVisible(settings, text, waits) {
  if (text === 'Extended thinking')
    return settings.reasoningVisible && settings.reasoningVisibleAfter <= waits();
  return settings.modelVisible && settings.modelVisibleAfter <= waits();
}
