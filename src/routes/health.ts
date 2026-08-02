import { Router } from "express";
import { isReady } from "../state/readiness.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  if (!isReady()) {
    res.status(503).json({ status: "starting" });
    return;
  }
  res.status(200).json({ status: "ok" });
});
