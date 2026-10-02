export function geminiMenuFixture(items, selectedAfterClick) {
  let selected = 'Flash-Lite';
  const clicked = [];
  const matcher = (value, text) =>
    value instanceof RegExp ? value.test(text) : text.includes(value);
  const collection = (entries) => ({
    first: () => collection(entries.slice(0, 1)),
    filter: ({ hasText, has, visible }) =>
      collection(entries.filter((item) => matchesFilter(item, { hasText, has, visible }))),
    async isVisible() {
      if (entries.length > 1) throw new Error('ambiguous');
      return entries.length === 1;
    },
    isEnabled: async () => entries[0]?.enabled !== false,
    innerText: async () => entries[0].label,
    evaluate: async (callback) =>
      callback({
        classList: { contains: (name) => name === 'selected' && entries[0]?.label === selected },
        querySelector: () => null,
      }),
    async click() {
      if (entries.length !== 1) throw new Error('ambiguous');
      clicked.push(entries[0].label);
      selected = selectedAfterClick ?? entries[0].label;
    },
  });
  function matchesFilter(item, { hasText, has, visible }) {
    if (visible !== undefined) return visible;
    if (has) return has.matches(item.label);
    return matcher(hasText, `${item.label}\n${item.description ?? ''}`);
  }
  const opener = {
    first() {
      return this;
    },
    isVisible: async () => true,
    isEnabled: async () => true,
    click: async () => {},
    innerText: async () => items.find((item) => item.label === selected)?.buttonText ?? selected,
  };
  return {
    clicked,
    selected: () => selected,
    page: {
      locator: (selector) => (selector === 'gem-menu-item' ? collection(items) : opener),
      getByText: (text, options) => ({
        matches: (label) => (options?.exact ? label === text : matcher(text, label)),
      }),
      waitForTimeout: async () => {},
    },
  };
}
