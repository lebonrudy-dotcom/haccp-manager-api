import React, { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../config";

export default function Temperatures({ clientId = null, seuilMin = -30, seuilMax = +10 }) {
  const [zones, setZones] = useState([]);
  const [zoneId, setZoneId] = useState("");
  const [temperature, setTemperature] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState([]);

  const loadZones = async () => {
    const url = clientId ? `${API_BASE}/zones?client_id=${clientId}` : `${API_BASE}/zones`;
    const r = await fetch(url);
    setZones(await r.json());
  };
  const loadTemps = async () => {
    const r = await fetch(`${API_BASE}/temperatures`);
    setList(await r.json());
  };

  useEffect(() => { loadZones(); loadTemps(); /* eslint-disable-next-line */ }, [clientId]);

  const conforme = useMemo(() => {
    const v = Number(temperature);
    if (Number.isNaN(v)) return true;
    return v >= seuilMin && v <= seuilMax;
  }, [temperature, seuilMin, seuilMax]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!zoneId || temperature === "") return;

    setLoading(true);
    try {
      let photo_url = null;

      // 1) Upload photo si choisie (via /storage/presign)
      if (photoFile) {
        const presign = await fetch(`${API_BASE}/storage/presign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: photoFile.name, type: photoFile.type || "image/jpeg" })
        });
        if (presign.ok) {
          const { putUrl, publicUrl } = await presign.json();
          await fetch(putUrl, { method: "PUT", body: photoFile }); // upload binaire direct
          photo_url = publicUrl;
        }
      }

      // 2) POST temperature
      const r = await fetch(`${API_BASE}/temperatures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zone_id: Number(zoneId),
          temperature: Number(temperature),
          conforme,
          photo_url
        })
      });

      if (r.ok) {
        setTemperature("");
        setPhotoFile(null);
        await loadTemps();
        alert("Relevé enregistré ✅");
      } else {
        const err = await r.json().catch(() => ({}));
        alert(`Erreur: ${err.error || r.status}`);
      }
    } catch (e) {
      alert("Erreur réseau");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 max-w-xl mx-auto">
      <h2 className="text-2xl font-bold mb-3">Relevé de température</h2>

      <form onSubmit={handleSend} className="space-y-3 mb-6">
        <select
          className="w-full border rounded-lg p-3 bg-white"
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value)}
        >
          <option value="">— Choisir une zone —</option>
          {zones.map(z => (
            <option key={z.id} value={z.id}>
              {z.nom} {z.type_zone ? `(${z.type_zone})` : ""}
            </option>
          ))}
        </select>

        <input
          className="w-full border rounded-lg p-3"
          type="number"
          step="0.1"
          placeholder="Température (°C)"
          value={temperature}
          onChange={(e) => setTemperature(e.target.value)}
        />

        <label className="block">
          <span className="text-sm text-gray-600">Photo (optionnel)</span>
          <input
            className="w-full mt-1"
            type="file"
            accept="image/*"
            onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
          />
        </label>

        <button
          disabled={loading || !zoneId || temperature === ""}
          className={`w-full rounded-xl py-3 font-medium ${
            conforme ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {loading ? "Envoi..." : (conforme ? "Enregistrer le relevé ✅" : "Enregistrer (ALERTE) 🚨")}
        </button>
      </form>

      <h3 className="text-lg font-semibold mb-2">Historique (50 derniers)</h3>
      <div className="space-y-3">
        {list.map(item => (
          <div key={item.id} className="border rounded-xl p-3 flex items-start justify-between">
            <div>
              <div className="font-semibold">{item.zone_nom || `Zone #${item.zone_id}`}</div>
              <div className="text-sm text-gray-600">
                {new Date(item.date_releve).toLocaleString()}
              </div>
              {item.photo_url && (
                <a className="text-sm text-emerald-700 underline" href={item.photo_url} target="_blank" rel="noreferrer">
                  Voir la photo
                </a>
              )}
            </div>
            <div className={`ml-3 px-3 py-1 rounded-full text-white ${item.conforme ? "bg-emerald-600" : "bg-red-600"}`}>
              {Number(item.temperature).toFixed(1)} °C
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <p className="text-gray-500">Aucun relevé pour le moment.</p>
        )}
      </div>
    </div>
  );
}
