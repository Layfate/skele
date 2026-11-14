// Agents: reusable assistants with their own instructions and, optionally, their own provider
// and model. Mention one or more with @name and each replies (in parallel); set one as a
// chat's default; or hand them to Claude Code as sub-agents it can delegate work to.

import { appMeta } from "@/data/registry";
import { newId, now } from "@/data/common";
import { serial } from "./store";
import type { Agent } from "./types";

const KEY = "ai:agents";

export const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export const listAgents = async (): Promise<Agent[]> => (await appMeta.get<Agent[]>(KEY)) ?? [];

export function validateAgent(a: Pick<Agent, "name" | "instructions">, others: Agent[], id?: string): string | null {
  if (!AGENT_NAME.test(a.name)) return "Use letters, digits, - and _ for the name (up to 32), e.g. reviewer.";
  if (others.some((o) => o.name.toLowerCase() === a.name.toLowerCase() && o.id !== id)) return `There's already an agent called @${a.name}.`;
  if (!a.instructions.trim()) return "Describe how this agent should work.";
  return null;
}

export function saveAgent(input: Omit<Agent, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<Agent> {
  return serial(async () => {
    const list = await listAgents();
    const error = validateAgent(input, list, input.id);
    if (error) throw new Error(error);
    const prev = list.find((a) => a.id === input.id);
    const agent: Agent = { ...input, id: input.id ?? newId(), createdAt: prev?.createdAt ?? now(), updatedAt: now() };
    await appMeta.set(KEY, prev ? list.map((a) => (a.id === agent.id ? agent : a)) : [...list, agent]);
    return agent;
  });
}

export const deleteAgent = (id: string) => serial(async () => appMeta.set(KEY, (await listAgents()).filter((a) => a.id !== id)));

/** Agents @mentioned in a message, in order, each once. */
export function mentionedAgents(text: string, agents: Agent[]): Agent[] {
  const byName = new Map(agents.map((a) => [a.name.toLowerCase(), a]));
  const out: Agent[] = [];
  for (const m of text.matchAll(/(^|[\s(])@([A-Za-z0-9][A-Za-z0-9_-]*)/g)) {
    const a = byName.get(m[2].toLowerCase());
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

const CLAUDE_ALIASES = new Set(["fable", "opus", "sonnet", "haiku"]);

/** Agents marked as sub-agents, in the shape Claude Code's --agents option takes. */
export function claudeSubagents(agents: Agent[], exclude?: string) {
  const out: Record<string, { description: string; prompt: string; model?: string }> = {};
  for (const a of agents) {
    if (!a.subagent || a.id === exclude) continue;
    out[a.name] = {
      description: a.description.trim() || `The ${a.name} assistant.`,
      prompt: a.instructions.trim(),
      ...(a.provider === "claude-cli" && CLAUDE_ALIASES.has(a.model) ? { model: a.model } : {}),
    };
  }
  return out;
}

export const AGENT_TEMPLATES: Pick<Agent, "name" | "description" | "instructions">[] = [
  {
    name: "reviewer",
    description: "Critiques drafts, plans and code, and points out risks.",
    instructions:
      "You are a careful, constructive reviewer. Point out mistakes, gaps, risks and unclear parts, most important first. Be specific and suggest a fix for each. Don't rewrite everything.",
  },
  {
    name: "researcher",
    description: "Digs into a question and reports findings with sources.",
    instructions:
      "You are a thorough researcher. Break the question down, look at it from several angles, separate facts from assumptions, and say how confident you are. Cite sources when you used any.",
  },
  {
    name: "editor",
    description: "Tightens and clarifies writing without changing its meaning.",
    instructions:
      "You are an editor. Make the text clearer, shorter and easier to read while keeping its meaning and the author's voice. Return the edited text, then a short list of the main changes.",
  },
  {
    name: "planner",
    description: "Turns goals into concrete, ordered steps.",
    instructions:
      "You are a planner. Turn the goal into a short, ordered list of concrete steps with owners or tools where relevant, call out dependencies and the riskiest step, and end with the first thing to do today.",
  },
];
