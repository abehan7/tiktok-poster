/**
 * `tiktok-poster`: drives the running TikTok Poster app from the terminal over its control socket
 * (see @shared/control). Everything goes through the app, so posts get the same checks, scheduling
 * and history as the UI.
 */
import { parseArgs } from "node:util";
import { AppNotRunning, Client } from "./client";
import { ALIASES, COMMANDS, UsageError, type Command, type Options } from "./commands";
import { c } from "./format";
import { WHEN_HELP } from "./time";

const GLOBAL: Options = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  yes: { type: "boolean", short: "y" },
};

const GROUPS: Array<[string, string[]]> = [
  ["Posting", ["post video", "post carousel", "import"]],
  ["Posts", ["list", "upcoming", "show", "wait", "reschedule", "post-now", "cancel", "refresh", "mark-published", "remove", "clear-cancelled"]],
  ["Accounts", ["accounts"]],
  ["App", ["status", "settings", "watch", "open"]],
];

function usage(): string {
  const name = (cmd: string) => cmd.padEnd(18);
  const groups = GROUPS.map(([title, cmds]) => [c.bold(title), ...cmds.map((cmd) => `  ${name(cmd)}${COMMANDS[cmd].summary}`)].join("\n"));
  return `${c.bold("tiktok-poster")}: post, schedule and manage TikTok and Instagram posts through the TikTok Poster app

${c.bold("Usage")}  tiktok-poster <command> [options]

${groups.join("\n\n")}

${c.bold("Global options")}
  --json            Machine-readable output
  -y, --yes         Don't ask before deleting or disconnecting
  -h, --help        Help for a command, e.g. tiktok-poster post video --help

Post IDs can be shortened to any unique prefix (list shows the first 8 characters).
Accounts can be given as @handle, display name or ID.
Times: ${WHEN_HELP}.
The app has to be running; if it's installed and not running, it's started in the background.`;
}

function commandHelp(name: string, cmd: Command): string {
  return [`${c.bold("Usage")}  tiktok-poster ${cmd.usage}`, "", cmd.summary, ...(cmd.details ? ["", cmd.details] : [])].join("\n");
}

/** "post video …" is a two-word command; everything else is one word. */
function findCommand(argv: string[]): { name: string; rest: string[] } | null {
  const words = argv.filter((a) => !a.startsWith("-"));
  for (const n of [2, 1]) {
    const key = words.slice(0, n).join(" ");
    const name = COMMANDS[key] ? key : ALIASES[key];
    if (!name) continue;
    // Drop exactly the words that named the command, wherever the flags sit.
    const rest = [...argv];
    for (const w of words.slice(0, n)) rest.splice(rest.indexOf(w), 1);
    return { name, rest };
  }
  return null;
}

async function main(argv: string[]): Promise<number> {
  if (!argv.length || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    const topic = argv[0] === "help" ? findCommand(argv.slice(1)) : null;
    console.log(topic ? commandHelp(topic.name, COMMANDS[topic.name]) : usage());
    return 0;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    const client = await Client.connect({ launch: false }).catch(() => null);
    console.log(client ? (await client.call("ping")).version : "TikTok Poster isn't running.");
    client?.close();
    return 0;
  }

  const found = findCommand(argv);
  if (!found) {
    const tried = argv.filter((a) => !a.startsWith("-")).slice(0, 2).join(" ");
    console.error(`${c.red("error")} Unknown command: ${tried}${tried === "post" ? " (post video | post carousel)" : ""}\nRun tiktok-poster --help for the list.`);
    return 2;
  }
  const cmd = COMMANDS[found.name];

  let client: Client | null = null;
  try {
    const { values, positionals } = parseArgs({ args: found.rest, options: { ...GLOBAL, ...cmd.options }, allowPositionals: true });
    if (values.help) {
      console.log(commandHelp(found.name, cmd));
      return 0;
    }
    const code = await cmd.run({
      values,
      positionals,
      json: Boolean(values.json),
      client: async () => (client ??= await Client.connect()),
    });
    return code ?? 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // parseArgs throws TypeErrors with a code for unknown / malformed options.
    const usageError = err instanceof UsageError || (err as { code?: string }).code?.startsWith("ERR_PARSE_ARGS");
    console.error(`${c.red("error")} ${msg}`);
    if (usageError) console.error(c.dim(`Usage: tiktok-poster ${cmd.usage}  (--help for more)`));
    return usageError ? 2 : err instanceof AppNotRunning ? 3 : 1;
  } finally {
    (client as Client | null)?.close();
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
