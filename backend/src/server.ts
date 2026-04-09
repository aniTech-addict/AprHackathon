import cors from "cors";
import express from "express";
import { checkDatabaseConnection } from "./db";
import { config } from "./config";
import { ensureCoreSchema } from "./db/schema";
import { researchRouter } from "./routes/research";

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/research", researchRouter);

app.get("/health", async (_req, res) => {
  try {
    await checkDatabaseConnection();
    res.status(200).json({
      status: "ok",
      service: "web-researcher-backend",
      db: "connected",
      env: config.nodeEnv,
    });
  } catch (_error) {
    res.status(500).json({
      status: "degraded",
      service: "web-researcher-backend",
      db: "disconnected",
    });
  }
});

async function startServer(): Promise<void> {
  await ensureCoreSchema();

  app.listen(config.port, () => {
    // This verifies the backend boots with the configured environment.
    console.log(`Backend listening on port ${config.port}`);
  });
}

function logStartupTroubleshooting(error: unknown): void {
  const asRecord = error as { code?: string; message?: string };
  const code = asRecord?.code;
  const message = String(asRecord?.message || "").toLowerCase();

  if (code === "28P01" || message.includes("password authentication failed")) {
    console.error(
      "[startup-help] PostgreSQL rejected credentials. If using docker-compose, run 'docker compose down -v' then 'docker compose up -d' to reset credentials to postgres/postgres."
    );
    console.error(
      "[startup-help] Also check if another local PostgreSQL instance is occupying port 5432 and update connection settings if needed."
    );
  }

  if (message.includes("client password must be a string")) {
    console.error(
      "[startup-help] DATABASE_URL is malformed or missing a password segment. Expected: postgres://user:password@host:port/dbname"
    );
  }
}

startServer().catch((error) => {
  logStartupTroubleshooting(error);
  console.error("Failed to start backend", error);
  process.exit(1);
});
