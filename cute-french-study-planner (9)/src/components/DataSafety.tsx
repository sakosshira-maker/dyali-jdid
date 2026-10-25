"use client";
import { useRef, useState } from "react";
import { ShieldCheck, Download, Upload, X, HardDrive, Loader2 } from "lucide-react";
import { exportBackup, importBackup, storageInfo } from "@/lib/local/store";
import { sfx } from "@/lib/sound";

type Info = Awaited<ReturnType<typeof storageInfo>>;
const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`);

export default function DataSafety() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const show = async () => {
    setOpen(true); setMessage(""); setError("");
    try { setInfo(await storageInfo()); } catch { setInfo(null); }
  };

  const download = async () => {
    setBusy(true); setError("");
    try {
      const blob = await exportBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mon-petit-cahier-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setMessage("Sauvegarde téléchargée. Garde ce fichier précieusement 💗");
      sfx.chime();
    } catch (e) { setError(e instanceof Error ? e.message : "Téléchargement impossible."); }
    finally { setBusy(false); }
  };

  const restore = async (file: File) => {
    if (!window.confirm("Remplacer toutes les données de ce navigateur par cette sauvegarde ?")) return;
    setBusy(true); setError("");
    try {
      await importBackup(file);
      setMessage("Sauvegarde restaurée ! Je recharge ton cahier…");
      sfx.magic();
      setTimeout(() => window.location.reload(), 900);
    } catch (e) { setError(e instanceof Error ? e.message : "Restauration impossible."); setBusy(false); }
  };

  return (
    <>
      <button
        onClick={() => void show()}
        className="btn-cute flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#F6DCE9] bg-white text-[#8A7BA6]"
        aria-label="Mes données et sauvegardes"
        title="Mes données et sauvegardes"
      >
        <ShieldCheck size={17} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#5b3a5e]/40 p-3 backdrop-blur-sm" onClick={() => !busy && setOpen(false)}>
          <div className="cute-card w-full max-w-md p-5" role="dialog" aria-modal="true" aria-label="Mes données" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-[Baloo_2] text-lg font-bold text-[#8A4B7C] flex items-center gap-2"><HardDrive size={18} className="text-pink-400" /> Mes données</h3>
              <button onClick={() => setOpen(false)} className="rounded-full bg-pink-100 p-1.5 text-pink-500" aria-label="Fermer"><X size={16} /></button>
            </div>
            <p className="text-xs leading-relaxed text-[#8A6D9E]">
              Tout ton cahier est enregistré <b>dans ce navigateur</b>, sur cet appareil : emploi du temps, matières, cahiers, notes vocales, humeurs… Aucun compte ni base de données externe.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-2xl bg-[#FFF0F6] p-3"><p className="font-[Baloo_2] text-lg font-extrabold text-[#C2255C]">{info ? size(info.usage) : "—"}</p><p className="text-[10px] font-bold text-[#B0799C]">espace utilisé</p></div>
              <div className="rounded-2xl bg-[#F0FBF4] p-3"><p className="font-[Baloo_2] text-sm font-extrabold text-[#1B7046]">{info ? (info.persisted ? "Protégées ✓" : "Standard") : "—"}</p><p className="text-[10px] font-bold text-[#6FA88B]">contre l'effacement auto</p></div>
            </div>
            <p className="mt-3 rounded-xl bg-[#FFFBE6] px-3 py-2 text-[11px] font-bold text-[#8A6A12]">
              Télécharge une sauvegarde de temps en temps : elle te permet de tout retrouver si tu changes d'appareil ou si les données du navigateur sont effacées.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <button disabled={busy} onClick={() => void download()} className="btn-cute flex items-center justify-center gap-2 rounded-full bg-[#D6336C] py-2.5 text-sm font-bold text-white disabled:opacity-60">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Télécharger ma sauvegarde
              </button>
              <button disabled={busy} onClick={() => fileRef.current?.click()} className="btn-cute flex items-center justify-center gap-2 rounded-full border-2 border-[#F6DCE9] bg-white py-2.5 text-sm font-bold text-[#8A4B7C] disabled:opacity-60">
                <Upload size={15} /> Restaurer une sauvegarde
              </button>
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="Fichier de sauvegarde" onChange={(e) => { const f = e.target.files?.[0]; if (f) void restore(f); e.target.value = ""; }} />
            </div>
            {message && <p role="status" className="mt-3 text-xs font-bold text-emerald-600">{message}</p>}
            {error && <p role="alert" className="mt-3 text-xs font-bold text-rose-600">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
