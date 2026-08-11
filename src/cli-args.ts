export type ChatArguments = {
  help: boolean;
  prompt?: string;
  provider?: string;
  systemInstructions?: string;
};

type ParseState = {
  promptParts: string[];
  provider?: string;
  systemInstructions?: string;
  flag?: string;
};
type OptionHandler = (option: string, args: string[], state: ParseState) => ChatArguments;

const optionHandlers: Record<string, OptionHandler> = {
  '--gem': parseSystemInstructions,
  '--gpt': parseSystemInstructions,
  '--provider': parseProvider,
  '--system-instructions': parseSystemInstructions,
};

export function parseChat(args: string[]): ChatArguments {
  return parseRemaining(args, { promptParts: [] });
}

function parseRemaining(args: string[], state: ParseState): ChatArguments {
  const [argument, ...remaining] = args;
  if (argument === undefined) return parsedArguments(state);
  if (isHelp(argument)) return { help: true };
  if (!argument.startsWith('--')) return parsePromptPart(argument, remaining, state);
  return parseOption(argument, remaining, state);
}

function isHelp(argument: string): boolean {
  return argument === '--help' || argument === '-h';
}

function parsePromptPart(argument: string, remaining: string[], state: ParseState): ChatArguments {
  state.promptParts.push(argument);
  return parseRemaining(remaining, state);
}

function parseOption(option: string, args: string[], state: ParseState): ChatArguments {
  const handler = optionHandlers[option];
  if (!handler) throw new Error(`Unknown option "${option}".`);
  return handler(option, args, state);
}

function parseProvider(_option: string, args: string[], state: ParseState): ChatArguments {
  const { value, remaining } = optionValue(args, '--provider');
  state.provider = value;
  return parseRemaining(remaining, state);
}

function parseSystemInstructions(option: string, args: string[], state: ParseState): ChatArguments {
  const { value, remaining } = optionValue(args, optionFlag(option, state));
  state.systemInstructions = value;
  return parseRemaining(remaining, state);
}

function optionFlag(flag: string, state: ParseState): string {
  if (state.flag)
    throw new Error(`Conflicting options: ${state.flag} cannot be combined with ${flag}.`);
  state.flag = flag;
  return flag;
}

function optionValue(args: string[], flag: string): { remaining: string[]; value: string } {
  const [value, ...remaining] = args;
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return { value, remaining };
}

function parsedArguments(state: ParseState): ChatArguments {
  return {
    help: false,
    prompt: state.promptParts.join(' ').trim() || undefined,
    provider: state.provider,
    systemInstructions: state.systemInstructions,
  };
}
