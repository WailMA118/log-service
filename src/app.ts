import express, { type Express } from "express";
import { healthRouter } from "./routes/health.js";

export function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(healthRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  return app;
}
