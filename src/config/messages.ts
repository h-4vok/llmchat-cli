export const messages = Object.freeze({
  auth: {
    sessionReused: 'Gemini session is ready and was reused.',
    sessionAuthenticated: 'Gemini authentication completed; session is ready.',
  },
  geminiLoginRequired: 'Gemini needs login in the visible browser window. Complete it manually.',
  authenticationAttention: {
    title: 'Authentication required',
    body: (provider: string) => `${provider} needs your attention to sign in.`,
  },
  unknownSession: 'Gemini UI changed: unable to determine authenticated session state.',
  loginStopped: 'Login browser stopped before authentication or cancellation',
} as const);
