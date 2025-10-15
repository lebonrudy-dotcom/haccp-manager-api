CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS entreprises (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nom TEXT NOT NULL,
  siret VARCHAR(14) UNIQUE NOT NULL,
  adresse TEXT,
  code_postal VARCHAR(10),
  ville TEXT,
  pays TEXT DEFAULT 'France',
  email_contact TEXT,
  actif BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM('admin','employe');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entreprise_id UUID REFERENCES entreprises(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'employe',
  created_at TIMESTAMP DEFAULT NOW()
);

DO $$ BEGIN
  CREATE TYPE livraison_etat AS ENUM('conforme','abime','souille','autre');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE nettoyage_proprete AS ENUM('propre','sale');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS livraisons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entreprise_id UUID REFERENCES entreprises(id) ON DELETE CASCADE,
  utilisateur_id UUID REFERENCES users(id) ON DELETE SET NULL,
  date_reception TIMESTAMP NOT NULL DEFAULT NOW(),
  fournisseur TEXT NOT NULL,
  lot TEXT,
  produit TEXT,
  temperature NUMERIC(5,2),
  etat_produit livraison_etat DEFAULT 'conforme',
  proprete_vehicule nettoyage_proprete DEFAULT 'propre',
  photo_url TEXT,
  signature_url TEXT,
  conforme BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS livraisons_idx ON livraisons(entreprise_id, date_reception);
