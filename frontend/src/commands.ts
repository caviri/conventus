// In-conversation slash commands. Some transform text and send a normal
// message (/shrug, /me, /poll), others perform a local or API action
// (/theme, /dm, /topic) and show ephemeral feedback only the sender sees.
import { api } from "./api";
import { useStore } from "./store";
import { generateAndApplyToBoard } from "./kanbanCards";
import { setTheme, toggleTheme, type Theme } from "./theme";
import type { User, View } from "./types";

export interface CommandContext {
  view: View;
  user: User;
  channelId?: number;
  /** Send a normal message to the current conversation. */
  send: (content: string) => Promise<void>;
  /** Show an ephemeral, client-only message (not persisted). */
  addLocal: (content: string, kind?: "system" | "bot") => void;
  openDm: (name: string) => Promise<void>;
  refreshChannels: () => Promise<void>;
}

export interface Command {
  name: string;
  args?: string;
  description: string;
  adminOnly?: boolean;
  run: (args: string, ctx: CommandContext) => void | Promise<void>;
}

const NUMS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

export const COMMANDS: Command[] = [
  {
    name: "help",
    description: "List the available slash commands",
    run: (_args, ctx) => {
      const lines = COMMANDS.map(
        (c) =>
          `\`/${c.name}${c.args ? " " + c.args : ""}\`${
            c.adminOnly ? " *(admin)*" : ""
          } — ${c.description}`
      ).join("\n");
      ctx.addLocal(`**Slash commands**\n${lines}`, "bot");
    },
  },
  {
    name: "me",
    args: "<action>",
    description: "Send an action message, e.g. /me waves",
    run: (args, ctx) => {
      if (!args) return ctx.addLocal("Usage: /me <action>");
      return ctx.send(`*${args}*`);
    },
  },
  {
    name: "shrug",
    args: "[message]",
    description: "Append ¯\\_(ツ)_/¯ to your message",
    run: (args, ctx) => ctx.send(`${args} ¯\\_(ツ)_/¯`.trim()),
  },
  {
    name: "tableflip",
    description: "(╯°□°)╯︵ ┻━┻",
    run: (_args, ctx) => ctx.send("(╯°□°)╯︵ ┻━┻"),
  },
  {
    name: "unflip",
    description: "┬─┬ ノ( ゜-゜ノ)",
    run: (_args, ctx) => ctx.send("┬─┬ ノ( ゜-゜ノ)"),
  },
  {
    name: "lenny",
    description: "( ͡° ͜ʖ ͡°)",
    run: (_args, ctx) => ctx.send("( ͡° ͜ʖ ͡°)"),
  },
  {
    name: "poll",
    args: "Question | option A | option B",
    description: "Post a poll; people vote with number reactions",
    run: (args, ctx) => {
      const parts = args.split("|").map((s) => s.trim()).filter(Boolean);
      if (parts.length < 2)
        return ctx.addLocal("Usage: /poll Question | option A | option B");
      const [question, ...opts] = parts;
      const body =
        `📊 **${question}**\n` +
        opts.map((o, i) => `${NUMS[i] || "•"} ${o}`).join("\n") +
        `\n\n*React with the matching number to vote.*`;
      return ctx.send(body);
    },
  },
  {
    name: "ask",
    args: "<question>",
    description: "Ask the Assistant — it replies here in the channel",
    run: async (args, ctx) => {
      const q = args.trim();
      if (!q) return ctx.addLocal("Usage: /ask <question>");
      const agent = useStore.getState().agent;
      if (!agent?.enabled)
        return ctx.addLocal(
          "The Assistant isn't enabled yet — an admin can set it up in Settings → Assistant."
        );
      // Mentioning the Assistant triggers its inline reply server-side.
      await ctx.send(`@${agent.name} ${q}`);
    },
  },
  {
    name: "kanban",
    args: "<board> <what to create>",
    description: "Generate kanban cards on a board from a prompt",
    run: async (args, ctx) => {
      const { agent, boards, members } = useStore.getState();
      if (!agent?.enabled)
        return ctx.addLocal(
          "The Assistant isn't enabled yet — an admin can set it up in Settings → Assistant."
        );
      const kanbans = boards.filter((b) => b.kind === "kanban");
      const m = args.match(/^(\S+)\s+([\s\S]+)$/);
      if (!m)
        return ctx.addLocal(
          `Usage: /kanban <board> <what to create>. Boards: ${
            kanbans.map((b) => b.name).join(", ") || "none"
          }`
        );
      const [, boardName, prompt] = m;
      const board = kanbans.find(
        (b) => b.name.toLowerCase() === boardName.toLowerCase()
      );
      if (!board)
        return ctx.addLocal(
          `No kanban board named “${boardName}”. Boards: ${
            kanbans.map((b) => b.name).join(", ") || "none"
          }`
        );
      ctx.addLocal(`Generating cards for “${board.name}”…`, "bot");
      try {
        const n = await generateAndApplyToBoard(
          board,
          prompt,
          members.map((x) => x.name)
        );
        ctx.addLocal(
          n > 0
            ? `Added ${n} card${n === 1 ? "" : "s"} to “${board.name}” ✓`
            : `No cards were generated for “${board.name}”.`,
          "bot"
        );
      } catch (e: any) {
        ctx.addLocal(`Couldn't generate cards: ${e.message || e}`);
      }
    },
  },
  {
    name: "dm",
    args: "<name>",
    description: "Open a direct message with someone",
    run: async (args, ctx) => {
      const name = args.trim().replace(/^@/, "");
      if (!name) return ctx.addLocal("Usage: /dm <name>");
      try {
        await ctx.openDm(name);
      } catch {
        ctx.addLocal(`No such user: ${name}`);
      }
    },
  },
  {
    name: "theme",
    args: "[light|dark]",
    description: "Switch your theme",
    run: (args, ctx) => {
      const a = args.trim().toLowerCase();
      let theme: Theme;
      if (a === "light" || a === "dark") {
        setTheme(a);
        theme = a;
      } else {
        theme = toggleTheme();
      }
      ctx.addLocal(`Theme → ${theme}`);
    },
  },
  {
    name: "topic",
    args: "<text>",
    description: "Set the current channel's topic",
    adminOnly: true,
    run: async (args, ctx) => {
      if (ctx.view.type !== "channel" || !ctx.channelId)
        return ctx.addLocal("/topic only works inside a channel");
      await api.patch(`/api/channels/${ctx.channelId}`, { topic: args });
      await ctx.refreshChannels();
      ctx.addLocal(args ? `Topic set to “${args}”` : "Topic cleared");
    },
  },
];

export function matchCommands(text: string): Command[] {
  const prefix = text.replace(/^\//, "").toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(prefix));
}

/** Returns true if the text was a known slash command (and was handled). */
export async function runCommand(
  raw: string,
  ctx: CommandContext
): Promise<boolean> {
  const m = raw.match(/^\/([a-zA-Z]+)\s*([\s\S]*)$/);
  if (!m) return false;
  const cmd = COMMANDS.find((c) => c.name === m[1].toLowerCase());
  if (!cmd) return false; // unknown — let it send as a normal message
  if (cmd.adminOnly && !ctx.user.is_admin) {
    ctx.addLocal(`/${cmd.name} is an admin-only command`);
    return true;
  }
  await cmd.run(m[2].trim(), ctx);
  return true;
}
