import { createPool } from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config()

export const conn = createPool({
    connectionLimit: 10,
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT!),
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!
});