import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { healthRouter } from "./routes/health.js";
import { ingestRouter, queryRouter } from "./routes/logs.js";
import { aggregateRouter } from "./routes/aggregate.js";

export function createApp(): Express {
  const app = express();
  app.use(express.json({limit: "10mb"}));
  app.use(healthRouter);
  // Register /logs/aggregate before /logs so the more specific route
  // wins in Express route matching.
  app.use(aggregateRouter);
  app.use(ingestRouter);
  app.use(queryRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // Catch malformed JSON and oversized payloads and return consistent error bodies.
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

    if (
      typeof err === "object" &&
      err !== null &&
      "type" in err &&
      (err as { type?: string }).type === "entity.too.large"
    ) {
      res.status(413).json({ error: "request body exceeds size limit" });
      return;
    }

    next(err);
  });

  return app;
}
