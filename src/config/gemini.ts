export const geminiConfig = Object.freeze({
  appUrl: 'https://gemini.google.com/app',
  providerUrlPrefix: 'https://gemini.google.com/',
  accountUrlPrefix: 'https://accounts.google.com/',
  selectors: {
    blocked: 'text=/unusual traffic|temporarily blocked|access denied|automated queries/i',
    captcha: 'iframe[src*="recaptcha"], text=/captcha|verify you are human/i',
    composer: 'div.ql-editor.textarea.new-input-ui[contenteditable="true"]',
    error: '[role="alert"], .error-message, .quota-error',
    login:
      'a[href*="accounts.google.com/ServiceLogin"], button[aria-label="Sign in"], a[aria-label="Sign in"]',
    loginText: 'text=/^Sign in$/i',
    authenticated:
      'a[gem-open-account-menu][href*="accounts.google.com/SignOutOptions"][aria-label^="Google Account:"]',
    model: 'button[data-test-id="bard-mode-menu-button"]',
    response: 'model-response .response-content, model-response',
    send: 'button[aria-label*="send" i], button[data-test-id*="send"]',
    stop: 'button[aria-label*="stop" i], button[data-test-id*="stop"]',
    temporaryChat: 'temp-chat-button',
  },
} as const);
