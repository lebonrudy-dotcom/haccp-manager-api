import express from "express";
import pkg from "pg";
const { Pool } = pkg;

const router = express.Router();

// Connexion à la base PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ➕ POST /livraisons : créer une nouvelle livraison
router.post("/", async (req, res, next) => {
  try {
    // 🔧 Accepte req.body (JSON/form) ou req.query (URL)
    const src = (req.body && Object.keys(req.body).length) ? req.body : req.query;
    console.log("📦 Données reçues /livraisons:", src);

    // Normalisation des champs
    const fournisseur        = src.fournisseur ?? src.Fournisseur ?? null;
    const lot                = src.lot ?? null;
    const produit            = src.produit ?? src.Produit ?? null;
    const temperature        = src.temperature ? Number(src.temperature) : null;
    const etat_produit       = src.etat_produit ?? 'conforme';
    const proprete_vehicule  = src.proprete_vehicule ?? 'propre';
    const photo_url          = src.photo_url ?? null;
    const signature_url      = src.signature_url ?? null;
    const conforme           = (src.conforme !== undefined)
                                  ? (String(src.conforme).toLowerCase() !== 'false')
                                  : true;

    // Vérif du champ principal
    if (!fournisseur) {
      return res.status(400).json({ error: 'Fournisseur requis', body_recu: src });
    }

    // IDs nulls pendant les tests
    const entreprise_id = null;
    const utilisateur_id = null;

    // Insertion SQL
    const q = `
      INSERT INTO livraisons
        (entreprise_id, utilisateur_id, fournisseur, lot, produit, temperature,
         etat_produit, proprete_vehicule, photo_url, signature_url, conforme, date_reception)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      RETURNING *;
    `;
    const vals = [
      entreprise_id,
      utilisateur_id,
      fournisseur,
      lot,
      produit,
      temperature,
      etat_produit,
      proprete_vehicule,
      photo_url,
      signature_url,
      conforme
    ];

    const r = await pool.query(q, vals);
    return res.status(201).json({ message: "Livraison enregistrée avec succès ✅", data: r.rows[0] });
  } catch (e) { next(e); }
});

// 📋 GET /livraisons : liste des livraisons
router.get("/", async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT id, fournisseur, produit, temperature, conforme, photo_url, date_reception
      FROM livraisons
      ORDER BY date_reception DESC
      LIMIT 50;
    `);
    res.json(r.rows);
  } catch (e) { next(e); }
});

export default router;

