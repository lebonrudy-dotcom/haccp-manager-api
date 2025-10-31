import React, { useEffect, useState } from "react";
import { API_BASE } from "../config";

export default function ZonesConfig({ clientId = null }) {
  const [zones, setZones] = useState([]);
  const [nom, setNom] = useState("");
  const [typeZone, setTypeZone] = useState("");

  const load = async () => {
    const url = clientId ? `${API_BASE}/zones?client_id=${clientId}` : `${API_BASE}/zones`;
    const r = await fetch(url);
    setZones(await r.json());
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);

  const addZone = async (e) => {
    e.preventDefault();
    if (!nom.trim()) return;
    const r = await fetch(`${API_BASE}/zones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom: nom.trim(), type_zone: typeZone || null, client_id: clientId })
    });
    if (r.ok) {
      setNom(""); setTypeZone("");
      load();
    }
  };

  const updateZone = async (id, newNom) => {
    const r = await fetch(`${API_BASE}/zones/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom: newNom })
    });
    if (r.ok) load();
  };

  const removeZone = async (id) => {
    if (!window.confirm("Supprimer cette zone ?")) return;
    const r = await fetch(`${API_BASE}/zones/${id}`, { method: "DELETE" });
    if (r.ok) load();
  };

  return (
    <div className="p-4 max-w-xl mx-auto">
      <h2 className="text-2xl font-bold mb-3">Configuration des zones</h2>

      <form onSubmit={addZone} className="space-y-2 mb-4">
        <input
          className="w-full border rounded-lg p-3"
          placeholder="Nom de la zone (ex: Frigo Viande)"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
        />
        <input
          className="w-full border rounded-lg p-3"
          placeholder="Type (frigo, congélateur, chambre froide...)"
          value={typeZone}
          onChange={(e) => setTypeZone(e.target.value)}
        />
        <button className="w-full bg-emerald-600 text-white rounded-xl py-3 font-medium">
          ➕ Ajouter la zone
        </button>
      </form>

      <div className="space-y-2">
        {zones.map(z => (
          <ZoneRow key={z.id} z={z} onSave={updateZone} onDelete={removeZone} />
        ))}
        {zones.length === 0 && (
          <p className="text-gray-500">Aucune zone. Ajoute au moins un frigo / congélateur / chambre froide.</p>
        )}
      </div>
    </div>
  );
}

function ZoneRow({ z, onSave, onDelete }) {
  const [edit, setEdit] = useState(false);
  const [value, setValue] = useState(z.nom);

  return (
    <div className="border rounded-xl p-3 flex items-center justify-between">
      <div className="flex-1 pr-3">
        {edit ? (
          <input
            className="w-full border rounded-lg p-2"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <div>
            <div className="font-semibold">{z.nom}</div>
            {z.type_zone && <div className="text-sm text-gray-500">{z.type_zone}</div>}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        {edit ? (
          <button
            className="px-3 py-2 bg-emerald-600 text-white rounded-lg"
            onClick={() => { onSave(z.id, value); setEdit(false); }}
          >
            Enregistrer
          </button>
        ) : (
          <button className="px-3 py-2 border rounded-lg" onClick={() => setEdit(true)}>
            Modifier
          </button>
        )}
        <button className="px-3 py-2 border rounded-lg text-red-600" onClick={() => onDelete(z.id)}>
          Supprimer
        </button>
      </div>
    </div>
  );
}
