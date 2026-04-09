import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  dbUrl:
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/web_researcher",
};
