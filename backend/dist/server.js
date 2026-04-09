"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const db_1 = require("./db");
const config_1 = require("./config");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.get("/health", async (_req, res) => {
    try {
        await (0, db_1.checkDatabaseConnection)();
        res.status(200).json({
            status: "ok",
            service: "web-researcher-backend",
            db: "connected",
            env: config_1.config.nodeEnv,
        });
    }
    catch (_error) {
        res.status(500).json({
            status: "degraded",
            service: "web-researcher-backend",
            db: "disconnected",
        });
    }
});
app.listen(config_1.config.port, () => {
    // This verifies the backend boots with the configured environment.
    console.log(`Backend listening on port ${config_1.config.port}`);
});
