"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.checkDatabaseConnection = checkDatabaseConnection;
const pg_1 = require("pg");
const config_1 = require("./config");
exports.pool = new pg_1.Pool({
    connectionString: config_1.config.dbUrl,
});
async function checkDatabaseConnection() {
    await exports.pool.query("SELECT 1");
}
