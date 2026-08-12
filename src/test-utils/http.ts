import type { AddressInfo } from "node:net";
import type { Express } from "express";

/**
 * Starts the given Express app on an ephemeral port, runs `callback`
 * against its real base URL, and always tears the server down
 * afterward -- including when `callback` throws.
 *
 * `createApp()` must be called (and passed in) AFTER any `vi.mock(...)`
 * calls in the test file, since Vitest requires mocks to be registered
 * before the modules that use them are imported. That's why this helper
 * takes an already-constructed `app` rather than importing/calling
 * `createApp` itself -- each test file stays in control of exactly when
 * `createApp()` runs relative to its own mocks.
 */
export async function withServer<T>(
  app: Express,
  callback: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = app.listen(0);

  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Failed to get server address");
  }

  const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

  try {
    return await callback(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
