export function temporaryChatElement(settings, element) {
  const temporaryChat = element('temporary-chat', settings.missing !== 'temporaryChat');
  if (settings.temporaryChatClickFails)
    temporaryChat.click = async () => {
      throw new Error('temporary chat click failed');
    };
  return temporaryChat;
}
