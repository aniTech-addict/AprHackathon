import cors from "cors";
import express from "express";
import { checkDatabaseConnection } from "./db";
import { config } from "./config";

const app = express();

app.use(cors());
app.use(express.json());

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

app.listen(config.port, () => {
  // This verifies the backend boots with the configured environment.
  console.log(`Backend listening on port ${config.port}`);
});
