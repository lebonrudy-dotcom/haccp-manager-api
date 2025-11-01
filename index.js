/**
 * HACCP Manager API — PostgreSQL Edition
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
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';

const { Pool } = pkg;
const app = express();

// === Configuration serveur ===
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const ARCHIVE_DIR = path.resolve('./archives');
if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

// Middlewares
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));
app.use(morgan('tiny'));

// === Connexion PostgreSQL ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined,
});

// === Utils ===
const signToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
const assertx = (cond, msg, code = 400) => { if (!cond) { const e = new Error(msg); e.status = code; throw e; } };

// === Santé & Diagnostic ===
app.get('/health', (_req, res) => res.json({
  ok: true, name: 'HACCP Manager API', by: 'LA CAMPANELLA CONCEPT',
  ts: new Date().toISOString(),
}));

app.get('/health/db', async (_req, res) => {
  try {
    const r = await pool.query('SELECT NOW()');
    res.json({ ok: true, database: 'connecté ✅', time: r.rows[0].now });
  } catch (err) {
    res.status(500).json({ ok: false, database: '❌ Erreur', error: err.message });
  }
});

// === Auth ===
app.post('/auth/register', async (req, res, next) => {
  try {
    const { entreprise, user } = req.body || {};
    assertx(entreprise?.nom, 'Nom entreprise requis');
    assertx(entreprise?.siret, 'SIRET requis');
    assertx(user?.email, 'Email requis');

    const client = await pool.connect();
    await client.query('BEGIN');

    const eRes = await client.query(
      `INSERT INTO entreprises(nom, siret) VALUES ($1,$2) RETURNING id, nom, siret`,
      [entreprise.nom, entreprise.siret]
    );

    const hash = await bcrypt.hash(user.password, 10);
    const uRes = await client.query(
      `INSERT INTO users(entreprise_id, nom, email, password_hash, role)
       VALUES ($1,$2,$3,$4,'admin') RETURNING id, nom, email, role`,
      [eRes.rows[0].id, user.nom, user.email.toLowerCase(), hash]
    );

    await client.query('COMMIT');
    const token = signToken({ uid: uRes.rows[0].id, eid: eRes.rows[0].id });
    res.status(201).json({ token, entreprise: eRes.rows[0], user: uRes.rows[0] });
    client.release();
  } catch (e) { next(e); }
});

app.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const uRes = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    assertx(uRes.rowCount === 1, 'Utilisateur introuvable', 401);

    const u = uRes.rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    assertx(ok, 'Mot de passe incorrect', 401);

    const token = signToken({ uid: u.id, eid: u.entreprise_id });
    res.json({ token, user: { id: u.id, email: u.email, role: u.role } });
  } catch (e) { next(e); }
});

// === Zones ===
app.get('/zones', async (_req, res, next) => {
  try {
    const r = await pool.query('SELECT * FROM zones ORDER BY id DESC');
    res.json(r.rows);
  } catch (e) { next(e); }
});

app.post('/zones', async (req, res, next) => {
  try {
    const { nom, type_zone } = req.body || {};
    const r = await pool.query(
      'INSERT INTO zones(nom, type_zone) VALUES ($1,$2) RETURNING *',
      [nom, type_zone]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

// === Températures ===
app.post('/temperatures', async (req, res, next) => {
  try {
    const { zone_id, temperature, conforme, responsable, typeProduit } = req.body;
    const r = await pool.query(
      `INSERT INTO temperatures(zone_id, temperature, conforme, responsable, typeProduit)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [zone_id, temperature, conforme ?? true, responsable ?? null, typeProduit ?? null]
    );
    res.status(201).json({ message: 'Relevé ajouté ✅', data: r.rows[0] });
  } catch (e) { next(e); }
});

app.get('/temperatures', async (_req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT t.*, z.nom AS zone_nom
      FROM temperatures t
      LEFT JOIN zones z ON z.id = t.zone_id
      ORDER BY t.timestamp DESC
      LIMIT 50;
    `);
    res.json(r.rows);
  } catch (e) { next(e); }
});

// === Nettoyages ===
app.get('/cleaning/tasks', async (_req, res, next) => {
  try {
    const r = await pool.query('SELECT * FROM cleaning_tasks ORDER BY id ASC');
    res.json(r.rows);
  } catch (e) { next(e); }
});

app.post('/cleaning/log', async (req, res, next) => {
  try {
    const { task_id, responsable, date, heure } = req.body;
    await pool.query(
      'INSERT INTO cleaning_logs(task_id, responsable, date, heure, done) VALUES ($1,$2,$3,$4,true)',
      [task_id, responsable, date, heure]
    );
    res.json({ success: true });
  } catch (e) { next(e); }
});

app.get('/cleaning/logs', async (req, res, next) => {
  try {
    const { date } = req.query;
    const r = await pool.query(`
      SELECT cl.*, ct.libelle, ct.frequence
      FROM cleaning_logs cl
      JOIN cleaning_tasks ct ON ct.id = cl.task_id
      WHERE cl.date = $1
      ORDER BY cl.id DESC
    `, [date]);
    res.json(r.rows);
  } catch (e) { next(e); }
});

// === Export PDF manuel ===
app.get('/export-pdf', async (req, res) => {
  try {
    const now = new Date();
    const mois = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const filepath = path.join(ARCHIVE_DIR, `${mois}-Rapport_HACCP.pdf`);

    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream(filepath));
    doc.fontSize(18).text(`Rapport HACCP - ${mois}`, { align: "center" });
    doc.moveDown();

    const result = await pool.query(`
      SELECT t.timestamp, t.temperature, t.responsable, t.typeProduit, z.nom AS zone
      FROM temperatures t
      LEFT JOIN zones z ON z.id = t.zone_id
      ORDER BY t.timestamp DESC;
    `);

    if (result.rows.length === 0) doc.text("Aucun relevé enregistré.");
    else result.rows.forEach(r =>
      doc.text(`${r.timestamp?.slice(0, 10) || "N/A"} | ${r.responsable || "?"} | ${r.zone || "?"} | ${r.typeproduit || "-"} | ${r.temperature ?? "?"} °C`)
    );

    doc.end();
    doc.on("finish", () => {
      console.log(`✅ Rapport généré : ${filepath}`);
      res.download(filepath);
    });
  } catch (err) {
    console.error("❌ Erreur /export-pdf :", err);
    res.status(500).json({ error: "Erreur serveur PDF" });
  }
});

// === Cron automatique : génération mensuelle + purge ===
cron.schedule("0 3 1 * *", async () => {
  try {
    console.log("🕒 Génération automatique du rapport HACCP...");
    const now = new Date();
    const mois = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const filepath = path.join(ARCHIVE_DIR, `${mois}-Rapport_HACCP.pdf`);

    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream(filepath));
    doc.fontSize(18).text(`Rapport HACCP - ${mois}`, { align: "center" });
    doc.moveDown();

    const result = await pool.query(`
      SELECT t.timestamp, t.temperature, t.responsable, t.typeProduit, z.nom AS zone
      FROM temperatures t
      LEFT JOIN zones z ON z.id = t.zone_id
      ORDER BY t.timestamp DESC;
    `);

    if (result.rows.length === 0) doc.text("Aucun relevé ce mois-ci.");
    else result.rows.forEach(r =>
      doc.text(`${r.timestamp?.slice(0, 10)} | ${r.responsable || "?"} | ${r.zone || "?"} | ${r.typeproduit || "-"} | ${r.temperature ?? "?"} °C`)
    );

    doc.end();
    console.log(`✅ Rapport mensuel généré : ${filepath}`);

    // Suppression anciens rapports
    const files = fs.readdirSync(ARCHIVE_DIR);
    const nowYM = now.getFullYear() * 12 + now.getMonth();
    for (const f of files) {
      const m = f.match(/^(\d{4})-(\d{2})-/);
      if (m) {
        const ym = parseInt(m[1]) * 12 + (parseInt(m[2]) - 1);
        if (nowYM - ym >= 12) {
          fs.unlinkSync(path.join(ARCHIVE_DIR, f));
          console.log(`🗑️ Supprimé ancien rapport : ${f}`);
        }
      }
    }
  } catch (err) {
    console.error("❌ Erreur Cron :", err);
  }
});

// === Gestion erreurs ===
app.use((err, req, res, _next) => {
  console.error("❌", err);
  res.status(err.status || 500).json({ error: err.message || "Erreur serveur" });
});

// === Démarrage serveur ===
app.listen(PORT, () => console.log(`🚀 HACCP Manager API running on :${PORT}`));
