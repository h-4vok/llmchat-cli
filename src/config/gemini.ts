export const geminiConfig = Object.freeze({
  appUrl: 'https://gemini.google.com/app',
  providerUrlPrefix: 'https://gemini.google.com/',
  accountUrlPrefix: 'https://accounts.google.com/',
  selectors: {
    blocked: 'text=/unusual traffic|temporarily blocked|access denied|automated queries/i',
    captcha: 'iframe[src*="recaptcha"], text=/captcha|verify you are human/i',
    composer:
      'div[role="textbox"][aria-label="Enter a prompt for Gemini"], div.ql-editor.textarea.new-input-ui[contenteditable="true"], rich-textarea [contenteditable="true"], textarea[aria-label*="prompt" i]',
    error: '[role="alert"], .error-message, .quota-error',
    login:
      'a[href*="accounts.google.com/ServiceLogin"], button[aria-label="Sign in"], a[aria-label="Sign in"]',
    loginText: 'text=/^Sign in$/i',
    authenticated:
      '[aria-label*="Google Account" i], [aria-label*="Sign out" i], a[href*="SignOutOptions"]',
    model:
      'button[aria-label^="Open mode picker"], button[aria-label*="mode" i], button[aria-label*="model" i], button[data-test-id*="mode" i], button[data-test-id*="model" i]',
    response: 'model-response .response-content, model-response',
    send: 'button[aria-label*="send" i], button[data-test-id*="send"]',
    stop: 'button[aria-label*="stop" i], button[data-test-id*="stop"]',
  },
} as const);
