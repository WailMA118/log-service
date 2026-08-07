import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { healthRouter } from "./routes/health.js";
import { ingestRouter, queryRouter } from "./routes/logs.js";

export function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(healthRouter);
  // Register /logs/aggregate before /logs so the more specific route
  // wins in Express route matching.
  app.use(ingestRouter);
  app.use(queryRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // Catch malformed JSON and return a consistent 400 error body.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (
      err instanceof SyntaxError &&
      "status" in err &&
      err.status === 400 &&
      "body" in err
    ) {
      res.status(400).json({ error: "malformed JSON in request body" });
      return;
    }
    next(err);
  });

  return app;
}
