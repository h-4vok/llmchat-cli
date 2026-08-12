import type { NativeNotification, NativeNotificationPort } from './native-notification.js';
import { nodeCommandRunner, type CommandResult } from './process-boundary.js';

export type NotificationRunner = {
  run(command: string, args: string[]): CommandResult;
};

type NotificationCommand = (notification: NativeNotification) => [string, string[]];

const commands: Partial<Record<NodeJS.Platform, NotificationCommand>> = {
  darwin: macCommand,
  win32: windowsCommand,
};

export function createSystemNotificationPort(
  platform: NodeJS.Platform = process.platform,
  runner: NotificationRunner = nodeCommandRunner,
): NativeNotificationPort {
  const command = commands[platform];
  if (!command) throw new Error('Native authentication notifications support Windows and macOS.');
  return {
    async send(notification) {
      const [executable, args] = command(notification);
      const result = runner.run(executable, args);
      if (result.status !== 0) throw notificationFailure(result);
    },
  };
}

function windowsCommand(notification: NativeNotification): [string, string[]] {
  const script = [
    '$title=$args[0];$message=$args[1]',
    '[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime]>$null',
    '$xml=[Windows.Data.Xml.Dom.XmlDocument]::new()',
    '$xml.LoadXml(\'<toast><visual><binding template="ToastGeneric"><text></text><text></text></binding></visual></toast>\')',
    '$text=$xml.GetElementsByTagName("text")',
    '$text.Item(0).AppendChild($xml.CreateTextNode($title))>$null',
    '$text.Item(1).AppendChild($xml.CreateTextNode($message))>$null',
    '$toast=[Windows.UI.Notifications.ToastNotification]::new($xml)',
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LLM Chat").Show($toast)',
  ].join(';');
  return [
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script, notification.title, notification.message],
  ];
}

function macCommand(notification: NativeNotification): [string, string[]] {
  const script =
    'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run';
  return ['osascript', ['-e', script, notification.title, notification.message]];
}

function notificationFailure(result: CommandResult): Error {
  const detail = result.stderr.trim() || `exit ${String(result.status)}`;
  return new Error(`Native notification failed: ${detail}`);
}
