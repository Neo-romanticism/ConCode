import { Router, Request, Response } from "express";
import { createTeam, getTeam, listTeams, updateTeam, deleteTeam } from "../store/teams.js";
import { PRESETS } from "../types/team.js";

const router = Router();

/**
 * GET /v1/teams
 * List all teams (presets + custom).
 */
router.get("/v1/teams", async (_req: Request, res: Response) => {
  try {
    const teams = await listTeams();
    res.json({ teams });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

/**
 * GET /v1/teams/presets
 * List built-in preset teams.
 */
router.get("/v1/teams/presets", (_req: Request, res: Response) => {
  const presets = Object.entries(PRESETS).map(([id, team]) => ({
    id,
    name: team.name,
    description: team.description,
    agents: team.agents.map((a) => ({ name: a.name, role: a.role, model: a.model })),
    workflow: team.workflow,
  }));
  res.json({ presets });
});

/**
 * POST /v1/teams
 * Create a new custom team.
 */
router.post("/v1/teams", async (req: Request, res: Response) => {
  try {
    const team = await createTeam(req.body);
    res.status(201).json({ team });
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      res.status(400).json({ error: "Invalid team definition", details: err });
      return;
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

/**
 * GET /v1/teams/:id
 * Get a specific team by ID.
 */
router.get("/v1/teams/:id", async (req: Request, res: Response) => {
  try {
    const team = await getTeam(req.params.id as string);
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    res.json({ team });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /v1/teams/:id
 * Update a custom team.
 */
router.put("/v1/teams/:id", async (req: Request, res: Response) => {
  try {
    const team = await updateTeam(req.params.id as string, req.body);
    if (!team) {
      res.status(404).json({ error: "Team not found or is a preset (presets cannot be modified)" });
      return;
    }
    res.json({ team });
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      res.status(400).json({ error: "Invalid team definition", details: err });
      return;
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /v1/teams/:id
 * Delete a custom team.
 */
router.delete("/v1/teams/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await deleteTeam(req.params.id as string);
    if (!deleted) {
      res.status(404).json({ error: "Team not found or is a preset (presets cannot be deleted)" });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

export default router;
