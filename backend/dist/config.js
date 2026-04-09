"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    port: Number(process.env.PORT || 4000),
    nodeEnv: process.env.NODE_ENV || "development",
    dbUrl: process.env.DATABASE_URL ||
        "postgres://postgres:postgres@localhost:5432/web_researcher",
};
