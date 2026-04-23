import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { Team, TeamSchema, PRESETS } from "../types/team.js";

/**
 * File-based team store.
 * Teams are stored as JSON files in a configurable directory.
 * No external DB dependency — easy to self-host.
 */

const STORE_DIR = process.env.CONCODE_STORE_DIR || path.join(process.cwd(), ".concode", "teams");

async function ensureDir(): Promise<void> {
  await fs.mkdir(STORE_DIR, { recursive: true });
}

function teamPath(id: string): string {
  return path.join(STORE_DIR, `${id}.json`);
}

export async function createTeam(input: unknown): Promise<Team> {
  await ensureDir();

  const parsed = TeamSchema.parse(input);
  const id = parsed.id || `team_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();

  const team: Team = {
    ...parsed,
    id,
    created_at: now,
    updated_at: now,
  };

  await fs.writeFile(teamPath(id), JSON.stringify(team, null, 2), "utf-8");
  return team;
}

export async function getTeam(id: string): Promise<Team | null> {
  // Check presets first
  if (PRESETS[id]) {
    return { ...PRESETS[id], id };
  }

  try {
    const data = await fs.readFile(teamPath(id), "utf-8");
    return JSON.parse(data) as Team;
  } catch {
    return null;
  }
}

export async function listTeams(): Promise<Team[]> {
  await ensureDir();

  const presetTeams = Object.entries(PRESETS).map(([id, team]) => ({
    ...team,
    id,
  }));

  try {
    const files = await fs.readdir(STORE_DIR);
    const customTeams = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          const data = await fs.readFile(path.join(STORE_DIR, f), "utf-8");
          return JSON.parse(data) as Team;
        })
    );
    return [...presetTeams, ...customTeams];
  } catch {
    return presetTeams;
  }
}

export async function updateTeam(id: string, input: unknown): Promise<Team | null> {
  // Can't update presets
  if (PRESETS[id]) return null;

  const existing = await getTeam(id);
  if (!existing) return null;

  const parsed = TeamSchema.parse(input);
  const team: Team = {
    ...parsed,
    id,
    created_at: existing.created_at,
    updated_at: new Date().toISOString(),
  };

  await fs.writeFile(teamPath(id), JSON.stringify(team, null, 2), "utf-8");
  return team;
}

export async function deleteTeam(id: string): Promise<boolean> {
  if (PRESETS[id]) return false;

  try {
    await fs.unlink(teamPath(id));
    return true;
  } catch {
    return false;
  }
}
