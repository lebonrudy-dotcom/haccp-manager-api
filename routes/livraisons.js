import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import pkg from "pg";
const { Pool } = pkg;

const router = express.Router();

// Connexion à la base PostgreSQL via Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// 📸 Configuration du stockage temporaire des photos
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 }, // max 5 Mo
});

// ➕ POST /livraisons : créer une nouvelle livraison
router.post("/", upload.single("photo"), async (req, res) => {
  try {
    const { fournisseur, produit, temperature, conforme, utilisateur_id, entreprise_id } = req.body;

    if (!fournisseur || !produit || !temperature) {
      return res.status(400).json({ error: "Champs requis manquants" });
    }

    // Sauvegarde temporaire de la photo
    let photo_url = null;
    if (req.file) {
      const photoPath = path.join("uploads", req.file.filename);
      photo_url = photoPath;
    }

    // Insertion dans la base
    const query = `
      INSERT INTO livraisons 
      (entreprise_id, utilisateur_id, fournisseur, produit, temperature, conforme, photo_url, date_reception)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *;
    `;

    const values = [
      entreprise_id || null,
      utilisateur_id || null,
      fournisseur,
      produit,
      temperature,
      conforme || true,
      photo_url,
    ];

    const result = await pool.query(query, values);
    res.status(201).json({ message: "Livraison enregistrée avec succès ✅", data: result.rows[0] });
  } catch (err) {
    console.error("Erreur lors de l’ajout de la livraison :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// 📋 GET /livraisons : liste des livraisons
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, fournisseur, produit, temperature, conforme, photo_url, date_reception
      FROM livraisons
      ORDER BY date_reception DESC
      LIMIT 50;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Erreur lors de la récupération :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
