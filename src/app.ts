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
  // aggregateRouter is registered before queryRouter so
  // GET /logs/aggregate is matched before the GET /logs handler --
  // Express matches routes in registration order, and /logs/aggregate
  // would otherwise never be reachable if a broader /logs pattern were
  // registered first (it currently isn't, since queryRouter's path is
  // the literal "/logs", not a prefix match, but this ordering keeps
  // the more specific route first defensively).
  app.use(ingestRouter);
  app.use(queryRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // Malformed JSON bodies are thrown by express.json() as a SyntaxError
  // before any route handler runs. Per the API contract, POST /logs must
  // return 400 with { error: "..." } for malformed JSON -- without this
  // handler, Express's default error response doesn't match that shape.
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
