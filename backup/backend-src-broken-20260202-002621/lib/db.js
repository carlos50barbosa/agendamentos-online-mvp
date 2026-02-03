// backend/src/lib/db.js
import mysql from 'mysql2/promise'
import { config } from './config.js'

export const pool = mysql.createPool({
host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.pass, database: config.db.name, waitForConnections: true, connectionLimit: 10, charset: 'utf8mb4',
}) || pool.on('connection', (connection) => {
connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_general_ci');
connection.query('SET character_set_connection=utf8mb4');
connection.query('SET character_set_results=utf8mb4');
connection.query('SET character_set_client=utf8mb4');
});


