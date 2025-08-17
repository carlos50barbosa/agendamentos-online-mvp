// backend/src/routes/estabelecimentos.js
import { Router } from "express";
import { pool } from "../lib/db.js";

const router = Router();

// Lista todos os usuários com perfil de estabelecimento
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, nome, email FROM usuarios WHERE tipo = 'estabelecimento' ORDER BY nome"
    );
    res.json(rows);
  } catch (e) {
    console.error("GET /establishments", e);
    res.status(500).json({ error: "list_establishments_failed" });
  }
});

// Alias em pt-BR (opcional): /estabelecimentos
router.get("/pt", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, nome, email FROM usuarios WHERE tipo = 'estabelecimento' ORDER BY nome"
    );
    res.json(rows);
  } catch (e) {
    console.error("GET /estabelecimentos", e);
    res.status(500).json({ error: "list_establishments_failed" });
  }
});

export default router;
