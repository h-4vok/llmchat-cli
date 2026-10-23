export function choiceVisible(settings, text, waits) {
  return settings.modelVisible && settings.modelVisibleAfter <= waits();
}
