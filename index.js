/**
 * HACCP Manager – API (Express + PostgreSQL + JWT + S3 presign)
 * by LA CAMPANELLA CONCEPT
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import pkg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MODULE_TEMPLATES } from "./models/modules.js";

const { Pool } = pkg;
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('tiny'));

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN }));

// PostgreSQL (Render/OVH). Activer SSL si PGSSL=require
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const PORT = process.env.PORT || 4000;

// S3 (OVH Object Storage compatible)
const s3 = new S3Client({
  region: process.env.S3_REGION || 'eu-west-1',
  endpoint: process.env.S3_ENDPOINT, // ex: https://s3.gra.io.cloud.ovh.net
  forcePathStyle: true,
  credentials: process.env.S3_ACCESS_KEY
    ? { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY }
    : undefined
});

// Utils
const signToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
const assertx = (cond, msg, code = 400) => { if (!cond) { const e = new Error(msg); e.status = code; throw e; } };

// Health
app.get('/health', (_req, res) => res.json({
  ok: true, name: 'HACCP Manager API', by: 'LA CAMPANELLA CONCEPT',
  ts: new Date().toISOString()
}));
// Vérifie la connexion à la base de données PostgreSQL
app.get('/health/db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      ok: true,
      service: "API Gestionnaire HACCP",
      database: "connecté ✅",
      time: result.rows[0].now
    });
  } catch (err) {
    console.error("Erreur de connexion PostgreSQL :", err);
    res.status(500).json({
      ok: false,
      service: "API Gestionnaire HACCP",
      database: "❌ Erreur de connexion",
      error: err.message
    });
  }
});

// Auth: register (crée l’entreprise + admin)
app.post('/auth/register', async (req, res, next) => {
  try {
    const { entreprise, user } = req.body || {};
    assertx(entreprise?.nom, 'Nom entreprise requis');
    assertx(entreprise?.siret && /^\d{14}$/.test(String(entreprise.siret).replace(/\s/g,'')), 'SIRET invalide (14 chiffres)');
    assertx(user?.nom, 'Nom utilisateur requis');
    assertx(user?.email && /.+@.+\..+/.test(user.email), 'Email invalide');
    assertx(user?.password && user.password.length >= 6, 'Mot de passe trop court (≥6)');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const eRes = await client.query(
        `INSERT INTO entreprises(nom, siret, adresse, code_postal, ville, pays, email_contact)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, nom, siret`,
        [
          entreprise.nom,
          String(entreprise.siret).replace(/\s/g,''),
          entreprise.adresse || null,
          entreprise.code_postal || null,
          entreprise.ville || null,
          entreprise.pays || 'France',
          entreprise.email_contact || null,
        ]
      );
      const ent = eRes.rows[0];
      const hash = await bcrypt.hash(user.password, 10);
      const uRes = await client.query(
        `INSERT INTO users(entreprise_id, nom, email, password_hash, role)
         VALUES ($1,$2,$3,$4,'admin') RETURNING id, nom, email, role`,
        [ent.id, user.nom, user.email.toLowerCase(), hash]
      );
      await client.query('COMMIT');
      const u = uRes.rows[0];
      const token = signToken({ uid: u.id, eid: ent.id, role: u.role });
      res.status(201).json({ token, entreprise: ent, user: u });
    } catch (e) {
      await client.query('ROLLBACK');
      if (String(e.message).includes('entreprises_siret_key'))
        return res.status(409).json({ error: 'SIRET déjà enregistré' });
      if (String(e.message).includes('users_email_key'))
        return res.status(409).json({ error: 'Email déjà enregistré' });
      throw e;
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// Auth: login
app.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    assertx(email && /.+@.+\..+/.test(email), 'Email invalide');
    assertx(password && password.length >= 6, 'Mot de passe requis');

    const uRes = await pool.query(
      `SELECT u.id, u.password_hash, u.role, u.nom, u.email, u.entreprise_id AS eid,
              e.nom AS entreprise_nom, e.siret
       FROM users u JOIN entreprises e ON e.id = u.entreprise_id
       WHERE u.email = $1`,
      [email.toLowerCase()]
    );
    assertx(uRes.rowCount === 1, 'Identifiants invalides', 401);

    const row = uRes.rows[0];
    const ok = await bcrypt.compare(password, row.password_hash);
    assertx(ok, 'Identifiants invalides', 401);

    const token = signToken({ uid: row.id, eid: row.eid, role: row.role });
    res.json({
      token,
      user: { id: row.id, nom: row.nom, email: row.email, role: row.role },
      entreprise: { id: row.eid, nom: row.entreprise_nom, siret: row.siret }
    });
  } catch (e) { next(e); }
});

app.get('/auth/me', (req, res) => {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Auth token manquant' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return res.json({ user: payload });
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
});

// Livraisons (création)
app.post('/livraisons', async (req, res, next) => {
  try {
    // 🔧 Accepter soit le body JSON/form, soit les query params
    const src = (req.body && Object.keys(req.body).length) ? req.body : req.query;
    console.log("📦 Données reçues /livraisons:", src);

    // Normalisation des champs (pour éviter les casses différentes)
    const fournisseur        = src.fournisseur ?? src.Fournisseur ?? src.fourni ?? null;
    const lot                = src.lot ?? null;
    const produit            = src.produit ?? src.Produit ?? null;
    const temperature        = (src.temperature !== undefined) ? Number(src.temperature) : null;
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

    // IDs désactivés pendant les tests
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
  } catch (e) {
    next(e);
  }
});

// Livraisons (liste)
app.get('/livraisons', async (req, res, next) => {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    assertx(token, 'Auth token manquant', 401);
    const user = jwt.verify(token, JWT_SECRET);

    const { limit = 20, offset = 0, from, to } = req.query;
    const clauses = ['entreprise_id = $1'];
    const params = [user.eid];
    if (from) { params.push(from); clauses.push(`date_reception >= $${params.length}`); }
    if (to)   { params.push(to);   clauses.push(`date_reception <= $${params.length}`); }
    params.push(limit); params.push(offset);

    const r = await pool.query(
      `SELECT * FROM livraisons WHERE ${clauses.join(' AND ')}
       ORDER BY date_reception DESC
       LIMIT $${params.length-1} OFFSET $${params.length}`, params
    );
    res.json(r.rows);
  } catch (e) { next(e); }
});

// Livraisons (détail)
app.get('/livraisons/:id', async (req, res, next) => {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    assertx(token, 'Auth token manquant', 401);
    const user = jwt.verify(token, JWT_SECRET);

    const r = await pool.query(
      `SELECT * FROM livraisons WHERE id = $1 AND entreprise_id = $2`,
      [req.params.id, user.eid]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Introuvable' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

// URL pré-signée pour upload photo (S3/OVH)
app.post('/storage/presign', async (req, res, next) => {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    assertx(token, 'Auth token manquant', 401);
    jwt.verify(token, JWT_SECRET);

    const { filename, type } = req.body || {};
    assertx(filename, 'filename requis');
    const safe = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const key = `livraisons/${Date.now()}_${safe}`;
    const cmd = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ContentType: type || 'application/octet-stream'
    });
    const putUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });
    const publicBase = process.env.S3_PUBLIC_BASE || `https://${process.env.S3_BUCKET}.s3.amazonaws.com`;
    const publicUrl = `${publicBase}/${key}`;
    res.json({ putUrl, publicUrl, key });
  } catch (e) { next(e); }
});

// Nettoyages — création
app.post('/nettoyages', async (req, res, next) => {
  try {
    const src = (req.body && Object.keys(req.body).length) ? req.body : req.query;
    console.log("🧽 Données reçues /nettoyages:", src);

    const zone            = src.zone ?? null;
    const responsable     = src.responsable ?? null;
    const produit_utilise = src.produit_utilise ?? null;
    const temperature_eau = src.temperature_eau !== undefined ? Number(src.temperature_eau) : null;
    const conforme        = (src.conforme !== undefined) ? (String(src.conforme).toLowerCase() !== 'false') : true;
    const photo_url       = src.photo_url ?? null;
    const commentaire     = src.commentaire ?? null;

    if (!zone || !responsable) {
      return res.status(400).json({ error: "Zone et responsable requis", body_recu: src });
    }

    // Pendant les tests, pas d’auth : on laisse NULL
    const entreprise_id  = null;
    const utilisateur_id = null;

    const q = `
      INSERT INTO nettoyages
        (entreprise_id, utilisateur_id, zone, responsable, produit_utilise,
         temperature_eau, conforme, photo_url, commentaire, date_nettoyage)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      RETURNING *;
    `;
    const vals = [entreprise_id, utilisateur_id, zone, responsable, produit_utilise,
                  temperature_eau, conforme, photo_url, commentaire];

    const r = await pool.query(q, vals);
    res.status(201).json({ message: "Nettoyage enregistré avec succès ✅", data: r.rows[0] });
  } catch (e) { next(e); }
});
// 🧠 Assistant IA — création automatique de modules

app.post("/assistant/create-module", async (req, res, next) => {
  try {
    const { module_name } = req.body || {};
    if (!module_name) return res.status(400).json({ error: "module_name requis" });

    const sql = MODULE_TEMPLATES[module_name.toLowerCase()];
    if (!sql) return res.status(400).json({ error: "Module inconnu" });

    console.log("🧱 Création du module :", module_name);
    await pool.query(sql);

    res.json({ message: `✅ Module '${module_name}' créé avec succès.` });
  } catch (e) {
    console.error("Erreur /assistant/create-module :", e);
    next(e);
  }
});
// === ZONES (config une fois puis modifiable) ===

// Liste des zones (optionnel: par client_id si tu l’utilises)
app.get('/zones', async (req, res, next) => {
  try {
    const { client_id } = req.query;
    const q = client_id
      ? 'SELECT * FROM zones WHERE client_id = $1 ORDER BY id DESC'
      : 'SELECT * FROM zones ORDER BY id DESC';
    const vals = client_id ? [client_id] : [];
    const r = await pool.query(q, vals);
    res.json(r.rows);
  } catch (e) { next(e); }
});

// Créer une zone
app.post('/zones', async (req, res, next) => {
  try {
    const { nom, type_zone, client_id } = req.body || {};
    if (!nom) return res.status(400).json({ error: 'nom requis' });
    const r = await pool.query(
      `INSERT INTO zones(client_id, nom, type_zone) VALUES ($1,$2,$3) RETURNING *`,
      [client_id ?? null, nom, type_zone ?? null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

// Renommer / modifier une zone
app.patch('/zones/:id', async (req, res, next) => {
  try {
    const { nom, type_zone } = req.body || {};
    const r = await pool.query(
      `UPDATE zones SET nom = COALESCE($1, nom), type_zone = COALESCE($2, type_zone) WHERE id = $3 RETURNING *`,
      [nom ?? null, type_zone ?? null, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Introuvable' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

// Supprimer une zone
app.delete('/zones/:id', async (req, res, next) => {
  try {
    const r = await pool.query(`DELETE FROM zones WHERE id = $1`, [req.params.id]);
    res.json({ ok: true, deleted: r.rowCount });
  } catch (e) { next(e); }
});
// === TEMPERATURES ===
app.post("/temperatures", async (req, res, next) => {
  try {
    const { zone_id, temperature, conforme, photo_url } = req.body || {};
    if (!zone_id || temperature === undefined) {
      return res.status(400).json({ error: "zone_id et temperature requis" });
    }
    const q = `
      INSERT INTO temperatures(zone_id, temperature, conforme, photo_url)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const vals = [zone_id, Number(temperature), conforme ?? true, photo_url ?? null];
    const r = await pool.query(q, vals);
    res.status(201).json({ message: "Relevé enregistré ✅", data: r.rows[0] });
  } catch (e) { next(e); }
});

app.get("/temperatures", async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT t.*, z.nom AS zone_nom
      FROM temperatures t
      LEFT JOIN zones z ON z.id = t.zone_id
      ORDER BY t.date_releve DESC
      LIMIT 50
    `);
    res.json(r.rows);
  } catch (e) { next(e); }
});

// Errors
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur' });
});
// Route d’accueil - vérifie si l’API et la base fonctionnent
app.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() as time");
    res.json({
      ok: true,
      service: "HACCP Manager API",
      database: "connected ✅",
      time: result.rows[0].time
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      service: "HACCP Manager API",
      database: "❌ not connected",
      error: err.message
    });
  }
});


app.listen(PORT, () => console.log(`HACCP Manager API running on :${PORT}`));
