export type NativeNotification = {
  kind: 'authentication-attention';
  provider: string;
  title: string;
  message: string;
};
import { messages } from './config/messages.js';

export interface NativeNotificationPort {
  send(notification: NativeNotification): Promise<void>;
}

export function authenticationAttention(provider: string): NativeNotification {
  return {
    kind: 'authentication-attention',
    provider,
    title: messages.authenticationAttention.title,
    message: messages.authenticationAttention.body(provider),
  };
}
