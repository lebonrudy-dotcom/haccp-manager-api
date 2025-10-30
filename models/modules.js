export const MODULE_TEMPLATES = {
  temperatures: `
    CREATE TABLE IF NOT EXISTS temperatures (
      id SERIAL PRIMARY KEY,
      zone_id INTEGER REFERENCES zones(id) ON DELETE CASCADE,
      temperature NUMERIC(5,2),
      date_releve TIMESTAMP DEFAULT NOW(),
      conforme BOOLEAN DEFAULT TRUE
    );
  `,
  congelations: `
    CREATE TABLE IF NOT EXISTS congelations (
      id SERIAL PRIMARY KEY,
      produit TEXT,
      temperature_initiale NUMERIC(5,2),
      temperature_finale NUMERIC(5,2),
      date_congelation TIMESTAMP DEFAULT NOW(),
      duree_heures NUMERIC(5,2),
      conforme BOOLEAN DEFAULT TRUE
    );
  `,
  refroidissements: `
    CREATE TABLE IF NOT EXISTS refroidissements (
      id SERIAL PRIMARY KEY,
      produit TEXT,
      temperature_initiale NUMERIC(5,2),
      temperature_finale NUMERIC(5,2),
      duree_minutes INTEGER,
      date_refroidissement TIMESTAMP DEFAULT NOW(),
      conforme BOOLEAN DEFAULT TRUE
    );
  `
};
