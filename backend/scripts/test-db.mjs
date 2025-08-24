import 'dotenv/config'
import mysql from 'mysql2/promise'

console.log('ENV_CHECK:', {
  DB_HOST: process.env.DB_HOST,
  DB_PORT: process.env.DB_PORT,
  DB_USER: process.env.DB_USER,
  DB_NAME: process.env.DB_NAME,
})

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
})

try {
  const [ping] = await pool.query('SELECT 1 AS ok')
  console.log('PING:', ping[0])

  const [[{ v: db }]]   = await pool.query('SELECT DATABASE() AS v')
  const [[{ v: user }]] = await pool.query('SELECT USER() AS v')
  console.log('DB_INFO:', { db, user })
  process.exit(0)
} catch (e) {
  console.error('DB ERROR:', e.message)
  process.exit(1)
}
