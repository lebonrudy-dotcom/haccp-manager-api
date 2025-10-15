# HACCP Manager – API (Render-ready)
by **LA CAMPANELLA CONCEPT**

API Node/Express + PostgreSQL + JWT + S3 presign (photos livraisons).

## Démarrage Render
- Build: `npm install`
- Start: `node index.js`
- Env: voir `.env.example`

## Initialiser la base
Exécuter `sql/init.sql` sur votre PostgreSQL (OVH/Render) :

```bash
psql "$DATABASE_URL" -f sql/init.sql
