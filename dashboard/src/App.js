// ============================================================
//  EnergyMonitor Dashboard — App.js
//  Pega este archivo completo en src/App.js
//
//  DEPENDENCIAS (ejecuta en terminal de VS Code):
//    npm install socket.io-client recharts
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import {
  LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

// ── Conexión ───────────────────────────────────────────────
const BACKEND_URL = "http://localhost:5000";
const WS_EVENT    = "energia";

// ── Temas de color ─────────────────────────────────────────
const TEMAS = {
  oscuro: {
    nombre: "Oscuro (por defecto)",
    bg: "#0a0e1a", bg2: "#111827", bg3: "#1a2236", bg4: "#222d42",
    border: "#2a3a5a", border2: "#3a4f70",
    text: "#e8edf5", text2: "#8899bb", text3: "#4a6090",
    accent: "#f97316", accent2: "#ea580c",
  },
  slate: {
    nombre: "Slate Profesional",
    bg: "#0f1117", bg2: "#161b22", bg3: "#21262d", bg4: "#30363d",
    border: "#30363d", border2: "#484f58",
    text: "#e6edf3", text2: "#8b949e", text3: "#6e7681",
    accent: "#58a6ff", accent2: "#1f6feb",
  },
  verde: {
    nombre: "Terminal Verde",
    bg: "#050e05", bg2: "#0a1a0a", bg3: "#0f260f", bg4: "#163316",
    border: "#1a4d1a", border2: "#236623",
    text: "#c8ffc8", text2: "#7abf7a", text3: "#4d804d",
    accent: "#39d353", accent2: "#26a641",
  },
  purpura: {
    nombre: "Púrpura Noche",
    bg: "#0d0a1a", bg2: "#130f24", bg3: "#1c1533", bg4: "#261e42",
    border: "#352a5a", border2: "#473a7a",
    text: "#ede8ff", text2: "#a89ac8", text3: "#6e5f99",
    accent: "#a78bfa", accent2: "#7c3aed",
  },
  ceniza: {
    nombre: "Ceniza Claro",
    bg: "#f4f5f7", bg2: "#ffffff", bg3: "#ebedf0", bg4: "#dde0e5",
    border: "#d0d3d9", border2: "#b0b5bf",
    text: "#1a1d23", text2: "#4a5060", text3: "#8a909d",
    accent: "#2563eb", accent2: "#1d4ed8",
  },
};

// ── Configuración por defecto ──────────────────────────────
const CONFIG_DEFAULT = {
  nombreSistema: "Planta Principal",
  nombreZona: "Zona A",
  voltajeWarnMin: 210,  voltajeWarnMax: 240,
  voltajeDangerMin: 200, voltajeDangerMax: 250,
  corrienteWarn: 4,     corrienteDanger: 5,
  potenciaWarn: 700,    potenciaDanger: 900,
  fpWarn: 0.8,
  intervaloGrafica: "30s",
  unidadEnergia: "kWh",
  umbralExport: 50,
  tarifaActiva: "pvpc_valle",
  tarifaCustomNombre: "",
  tarifaCustomPrecio: "",
  popupAlertas: true,
  tema: "oscuro",
};

// ── Tarifas preinstaladas ──────────────────────────────────
// PENDIENTE: sustituir precios por fuentes oficiales (REE / CNMC)
const TARIFAS_PRESET = [
  { id: "pvpc_valle", nombre: "PVPC Valle",      precio: 0.080, nota: "Fuente: pendiente (REE)" },
  { id: "pvpc_llano", nombre: "PVPC Llano",      precio: 0.120, nota: "Fuente: pendiente (REE)" },
  { id: "pvpc_punta", nombre: "PVPC Punta",      precio: 0.180, nota: "Fuente: pendiente (REE)" },
  { id: "libre_a",    nombre: "Tarifa Libre A",  precio: 0.140, nota: "Fuente: pendiente" },
  { id: "libre_b",    nombre: "Tarifa Libre B",  precio: 0.160, nota: "Fuente: pendiente" },
  { id: "nocturna",   nombre: "Tarifa Nocturna", precio: 0.060, nota: "Fuente: pendiente" },
];

// ── Helpers puros (sin hooks, seguros en cualquier lugar) ──
function ahora() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0")).join(":");
}

function apiPorIntervalo(intervalo) {
  const map = {
    "30s":  `${BACKEND_URL}/historico`,
    "1min": `${BACKEND_URL}/historico_1min`,
    "5min": `${BACKEND_URL}/historico_5min`,
    "10min":`${BACKEND_URL}/historico_10min`,
  };
  return map[intervalo] || map["30s"];
}

// Funciones de estado puras — reciben config como argumento
function calcEstadoV(v, cfg) {
  if (v < cfg.voltajeDangerMin || v > cfg.voltajeDangerMax) return "danger";
  if (v < cfg.voltajeWarnMin   || v > cfg.voltajeWarnMax)   return "warn";
  return "normal";
}
function calcEstadoI(i, cfg) {
  if (i >= cfg.corrienteDanger) return "danger";
  if (i >= cfg.corrienteWarn)   return "warn";
  return "normal";
}
function calcEstadoP(p, cfg) {
  if (p >= cfg.potenciaDanger) return "danger";
  if (p >= cfg.potenciaWarn)   return "warn";
  return "normal";
}
function calcEstadoFP(fp, cfg) {
  return fp < cfg.fpWarn ? "warn" : "normal";
}

// ── Tooltip de gráfica ─────────────────────────────────────
function CustomTooltip({ active, payload, label, temaObj }) {
  if (!active || !payload?.length) return null;
  const T = temaObj;
  return (
    <div style={{ background: T.bg3, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 11, fontFamily: "monospace" }}>
      <p style={{ color: T.text3, marginBottom: 4 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
}

// ── COMPONENTE: Login ──────────────────────────────────────
function Login({ onLogin }) {
  const [user, setUser]   = useState("admin");
  const [pass, setPass]   = useState("");
  const [error, setError] = useState(false);

  function handleLogin() {
    if (user === "admin" && pass === "1234") onLogin(user);
    else setError(true);
  }

  const inp = {
    width: "100%", background: "#1a2236", border: "1px solid #3a4f70",
    color: "#e8edf5", padding: "9px 12px", borderRadius: 6,
    fontSize: 13, outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0a0e1aee", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#111827", border: "1px solid #3a4f70", borderRadius: 16, padding: 32, width: 320 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <div style={{ width: 36, height: 36, background: "linear-gradient(135deg,#f97316,#ea580c)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="18" viewBox="0 0 12 16" fill="white"><path d="M7 0L0 9h5l-1 7 7-10H6L7 0z"/></svg>
          </div>
          <span style={{ fontSize: 18, fontWeight: 500, color: "#e8edf5" }}>EnergyMonitor</span>
        </div>
        <p style={{ fontSize: 12, color: "#4a6090", fontFamily: "monospace", marginBottom: 24 }}>sistema de monitorización · v2.1</p>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontFamily: "monospace", color: "#4a6090", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>Usuario</label>
          <input style={inp} value={user} onChange={(e) => setUser(e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontFamily: "monospace", color: "#4a6090", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>Contraseña</label>
          <input style={inp} type="password" value={pass}
            onChange={(e) => { setPass(e.target.value); setError(false); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          />
        </div>
        {error && <p style={{ fontSize: 11, color: "#ef4444", fontFamily: "monospace", marginBottom: 8 }}>Credenciales incorrectas</p>}
        <button onClick={handleLogin} style={{ width: "100%", background: "#f97316", border: "none", color: "white", padding: 10, borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          Entrar al sistema
        </button>
        <p style={{ fontSize: 10, color: "#4a6090", fontFamily: "monospace", marginTop: 16, textAlign: "center" }}>demo: admin / 1234</p>
      </div>
    </div>
  );
}

// ── COMPONENTE: Pop-up de alerta ───────────────────────────
function PopupAlerta({ alerta, onClose, T }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);

  const colores = { warn: "#eab308", danger: "#ef4444", ok: "#22c55e", info: "#3b82f6" };
  const color = colores[alerta.tipo] || colores.info;

  return (
    <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: T.bg2, border: `1px solid ${color}`, borderLeft: `4px solid ${color}`, borderRadius: 10, padding: "14px 16px", minWidth: 280, maxWidth: 360, boxShadow: "0 8px 32px #0008", animation: "slideIn .25s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <p style={{ fontSize: 11, fontFamily: "monospace", color, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>
            {alerta.tipo === "danger" ? "⛔ Alerta crítica" : "⚠ Advertencia"}
          </p>
          <p style={{ fontSize: 13, color: T.text, lineHeight: 1.4 }}>{alerta.texto}</p>
          <p style={{ fontSize: 10, color: T.text3, fontFamily: "monospace", marginTop: 4 }}>{alerta.t}</p>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 16, padding: 0 }}>✕</button>
      </div>
    </div>
  );
}

// ── COMPONENTE: Configuración ──────────────────────────────
function VistaConfiguracion({ config, setConfig, T }) {
  const [draft, setDraft]           = useState({ ...config });
  const [tcNombre, setTcNombre]     = useState(config.tarifaCustomNombre || "");
  const [tcPrecio, setTcPrecio]     = useState(config.tarifaCustomPrecio || "");
  const [guardado, setGuardado]     = useState(false);
  const fileRef                     = useRef();

  function set(key, val) { setDraft((p) => ({ ...p, [key]: val })); }

  function aplicar() {
    setConfig({ ...draft, tarifaCustomNombre: tcNombre, tarifaCustomPrecio: tcPrecio });
    setGuardado(true);
    setTimeout(() => setGuardado(false), 2000);
  }

  function guardarJSON() {
    const cfg  = { ...draft, tarifaCustomNombre: tcNombre, tarifaCustomPrecio: tcPrecio };
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = "energy_config.json";
    a.click();
  }

  function cargarJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const p = JSON.parse(ev.target.result);
        setDraft({ ...CONFIG_DEFAULT, ...p });
        setTcNombre(p.tarifaCustomNombre || "");
        setTcPrecio(p.tarifaCustomPrecio || "");
      } catch { alert("Archivo inválido"); }
    };
    reader.readAsText(file);
  }

  const inp = { background: T.bg3, border: `1px solid ${T.border2}`, color: T.text, padding: "7px 10px", borderRadius: 6, fontSize: 12, fontFamily: "monospace", outline: "none", width: "100%", boxSizing: "border-box" };
  const num = { ...inp, width: 100 };

  const tarifasTodas = [
    ...TARIFAS_PRESET,
    ...(tcNombre && tcPrecio ? [{ id: "custom", nombre: tcNombre, precio: parseFloat(tcPrecio), nota: "Tarifa personalizada" }] : []),
  ];

  const Bloque = ({ titulo, children }) => (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <p style={{ fontSize: 10, fontFamily: "monospace", color: T.text3, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 16, borderBottom: `1px solid ${T.border}`, paddingBottom: 10 }}>{titulo}</p>
      {children}
    </div>
  );

  const F = ({ label, hint, children }) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 10, fontFamily: "monospace", color: T.text2, display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 10, color: T.text3, marginTop: 3, fontFamily: "monospace" }}>{hint}</p>}
    </div>
  );

  return (
    <div style={{ flex: 1, padding: 20, overflowY: "auto" }}>
      {/* Cabecera */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 500, color: T.text, margin: 0 }}>Configuración</h2>
          <p style={{ fontSize: 11, color: T.text3, fontFamily: "monospace", marginTop: 4 }}>Los cambios no se aplican hasta pulsar "Aplicar cambios"</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={cargarJSON} />
          <button onClick={() => fileRef.current.click()} style={{ background: T.bg3, border: `1px solid ${T.border2}`, color: T.text2, fontSize: 11, padding: "7px 14px", borderRadius: 6, cursor: "pointer" }}>↑ Cargar config</button>
          <button onClick={guardarJSON}                   style={{ background: T.bg3, border: `1px solid ${T.border2}`, color: T.text2, fontSize: 11, padding: "7px 14px", borderRadius: 6, cursor: "pointer" }}>↓ Guardar config</button>
          <button onClick={aplicar}                       style={{ background: guardado ? "#22c55e" : T.accent, border: "none", color: "white", fontSize: 11, padding: "7px 18px", borderRadius: 6, cursor: "pointer", fontWeight: 500, transition: "background .3s" }}>
            {guardado ? "✓ Aplicado" : "Aplicar cambios"}
          </button>
        </div>
      </div>

      {/* Sistema */}
      <Bloque titulo="Sistema">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <F label="Nombre del sistema"><input style={inp} value={draft.nombreSistema} onChange={(e) => set("nombreSistema", e.target.value)} /></F>
          <F label="Zona"><input style={inp} value={draft.nombreZona} onChange={(e) => set("nombreZona", e.target.value)} /></F>
          <F label="Umbral exportación CSV" hint="Registros incluidos al exportar">
            <select style={inp} value={draft.umbralExport} onChange={(e) => set("umbralExport", Number(e.target.value))}>
              {[50, 100, 200, 500].map((v) => <option key={v} value={v}>{v} registros</option>)}
            </select>
          </F>
          <F label="Unidad energía acumulada">
            <select style={inp} value={draft.unidadEnergia} onChange={(e) => set("unidadEnergia", e.target.value)}>
              <option value="kWh">kWh</option>
              <option value="Wh">Wh</option>
            </select>
          </F>
        </div>
      </Bloque>

      {/* Rangos alerta */}
      <Bloque titulo="Rangos de alerta">
        <p style={{ fontSize: 11, color: T.text2, fontFamily: "monospace", marginBottom: 8 }}>Voltaje (V)</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
          <F label="Warn mín">   <input style={num} type="number" value={draft.voltajeWarnMin}    onChange={(e) => set("voltajeWarnMin",    +e.target.value)} /></F>
          <F label="Warn máx">   <input style={num} type="number" value={draft.voltajeWarnMax}    onChange={(e) => set("voltajeWarnMax",    +e.target.value)} /></F>
          <F label="Danger mín"> <input style={num} type="number" value={draft.voltajeDangerMin}  onChange={(e) => set("voltajeDangerMin",  +e.target.value)} /></F>
          <F label="Danger máx"> <input style={num} type="number" value={draft.voltajeDangerMax}  onChange={(e) => set("voltajeDangerMax",  +e.target.value)} /></F>
        </div>
        <p style={{ fontSize: 11, color: T.text2, fontFamily: "monospace", marginBottom: 8 }}>Corriente (A)</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
          <F label="Warn máx">   <input style={num} type="number" step="0.1" value={draft.corrienteWarn}   onChange={(e) => set("corrienteWarn",   +e.target.value)} /></F>
          <F label="Danger máx"> <input style={num} type="number" step="0.1" value={draft.corrienteDanger} onChange={(e) => set("corrienteDanger", +e.target.value)} /></F>
        </div>
        <p style={{ fontSize: 11, color: T.text2, fontFamily: "monospace", marginBottom: 8 }}>Potencia (W)</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
          <F label="Warn">   <input style={num} type="number" value={draft.potenciaWarn}   onChange={(e) => set("potenciaWarn",   +e.target.value)} /></F>
          <F label="Danger"> <input style={num} type="number" value={draft.potenciaDanger} onChange={(e) => set("potenciaDanger", +e.target.value)} /></F>
        </div>
        <p style={{ fontSize: 11, color: T.text2, fontFamily: "monospace", marginBottom: 8 }}>Factor de potencia</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
          <F label="Warn por debajo de"> <input style={num} type="number" step="0.01" min="0" max="1" value={draft.fpWarn} onChange={(e) => set("fpWarn", +e.target.value)} /></F>
        </div>
      </Bloque>

      {/* Gráfica */}
      <Bloque titulo="Gráfica e histórico">
        <p style={{ fontSize: 10, fontFamily: "monospace", color: T.text2, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>Intervalo de datos</p>
        <p style={{ fontSize: 10, color: T.text3, fontFamily: "monospace", marginBottom: 12 }}>Cada intervalo usa su propio archivo SQLite en el backend</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            { val: "30s",   label: "30 segundos", db: "energia.db" },
            { val: "1min",  label: "1 minuto",    db: "energia_1min.db" },
            { val: "5min",  label: "5 minutos",   db: "energia_5min.db" },
            { val: "10min", label: "10 minutos",  db: "energia_10min.db" },
          ].map((op) => (
            <div key={op.val} onClick={() => set("intervaloGrafica", op.val)} style={{ padding: "10px 16px", borderRadius: 8, cursor: "pointer", border: `1px solid ${draft.intervaloGrafica === op.val ? T.accent : T.border}`, background: draft.intervaloGrafica === op.val ? T.accent + "22" : T.bg3, color: draft.intervaloGrafica === op.val ? T.accent : T.text2, fontSize: 12, fontFamily: "monospace", transition: "all .15s" }}>
              <div style={{ fontWeight: 500 }}>{op.label}</div>
              <div style={{ fontSize: 10, opacity: .6, marginTop: 2 }}>{op.db}</div>
            </div>
          ))}
        </div>
      </Bloque>

      {/* Tarifas */}
      <Bloque titulo="Tarifa eléctrica">
        <p style={{ fontSize: 10, fontFamily: "monospace", color: T.text2, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>Tarifa activa</p>
        <p style={{ fontSize: 10, color: T.text3, fontFamily: "monospace", marginBottom: 12 }}>Precios orientativos — pendiente de fuentes oficiales (REE / CNMC)</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 20 }}>
          {tarifasTodas.map((t) => (
            <div key={t.id} onClick={() => set("tarifaActiva", t.id)} style={{ padding: "10px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${draft.tarifaActiva === t.id ? T.accent : T.border}`, background: draft.tarifaActiva === t.id ? T.accent + "22" : T.bg3, color: draft.tarifaActiva === t.id ? T.accent : T.text2, fontSize: 12, transition: "all .15s" }}>
              <div style={{ fontWeight: 500, marginBottom: 2 }}>{t.nombre}</div>
              <div style={{ fontSize: 14, fontFamily: "monospace" }}>€{t.precio.toFixed(3)}/kWh</div>
              <div style={{ fontSize: 9, opacity: .6, marginTop: 3 }}>{t.nota}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 10, fontFamily: "monospace", color: T.text3, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>Tarifa personalizada</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <F label="Nombre"><input style={inp} value={tcNombre} onChange={(e) => setTcNombre(e.target.value)} placeholder="Mi tarifa" /></F>
          <F label="Precio (€/kWh)"><input style={inp} type="number" step="0.001" min="0" value={tcPrecio} onChange={(e) => setTcPrecio(e.target.value)} placeholder="0.000" /></F>
        </div>
      </Bloque>

      {/* Notificaciones */}
      <Bloque titulo="Notificaciones">
        <div onClick={() => set("popupAlertas", !draft.popupAlertas)} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "12px 14px", background: T.bg3, borderRadius: 8, border: `1px solid ${T.border}`, width: "fit-content" }}>
          <div style={{ width: 38, height: 22, borderRadius: 11, position: "relative", background: draft.popupAlertas ? T.accent : T.border2, flexShrink: 0, transition: "background .2s" }}>
            <div style={{ position: "absolute", top: 3, left: draft.popupAlertas ? 19 : 3, width: 16, height: 16, borderRadius: "50%", background: "white", transition: "left .2s" }} />
          </div>
          <div>
            <p style={{ fontSize: 13, color: T.text, margin: 0 }}>Pop-up de alertas</p>
            <p style={{ fontSize: 11, color: T.text3, margin: 0, fontFamily: "monospace" }}>{draft.popupAlertas ? "Activado" : "Desactivado"}</p>
          </div>
        </div>
      </Bloque>

      {/* Temas */}
      <Bloque titulo="Tema de color">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          {Object.entries(TEMAS).map(([id, tema]) => (
            <div key={id} onClick={() => set("tema", id)} style={{ borderRadius: 10, overflow: "hidden", cursor: "pointer", border: `2px solid ${draft.tema === id ? T.accent : T.border}`, transition: "border-color .15s" }}>
              <div style={{ background: tema.bg, padding: "10px 12px", display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: tema.accent }} />
                <div style={{ width: 30, height: 6, borderRadius: 3, background: tema.bg3 }} />
                <div style={{ width: 20, height: 6, borderRadius: 3, background: tema.border2 }} />
              </div>
              <div style={{ background: tema.bg2, padding: "6px 12px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: tema.text2 }}>{tema.nombre}</span>
                {draft.tema === id && <span style={{ fontSize: 12, color: T.accent }}>✓</span>}
              </div>
            </div>
          ))}
        </div>
      </Bloque>
    </div>
  );
}

// ── APP PRINCIPAL ──────────────────────────────────────────
export default function App() {
  // ── TODOS los hooks siempre al principio, sin excepción ──
  const [loggedIn, setLoggedIn]       = useState(false);
  const [usuario, setUsuario]         = useState("");
  const [online, setOnline]           = useState(false);
  const [datos, setDatos]             = useState({ voltaje: 0, corriente: 0, potencia: 0, fp: 0 });
  const [historico, setHistorico]     = useState([]);
  const [tabla, setTabla]             = useState([]);
  const [alertas, setAlertas]         = useState([]);
  const [popup, setPopup]             = useState(null);
  const [activeTab, setActiveTab]     = useState("potencia");
  const [vistaActual, setVistaActual] = useState("dashboard");
  const [config, setConfig]           = useState({ ...CONFIG_DEFAULT });
  const socketRef                     = useRef(null);

  // addAlerta como useCallback normal, sin condiciones
  const addAlerta = useCallback((tipo, texto) => {
    const nueva = { tipo, texto, t: ahora(), id: Date.now() };
    setAlertas((prev) => [nueva, ...prev].slice(0, 20));
    setPopup((prev) => {
      // Solo mostrar popup si está activado en config y es alerta real
      // Accedemos a config mediante la referencia del estado
      return nueva;
    });
  }, []);

  // Ref para acceder a config dentro de callbacks sin recrearlos
  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);

  // WebSocket — se ejecuta siempre, pero solo conecta si loggedIn
  useEffect(() => {
    if (!loggedIn) return;

    const socket = io(BACKEND_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect",    () => { setOnline(true);  addAlerta("ok",     "Conexión WebSocket establecida"); });
    socket.on("disconnect", () => { setOnline(false); addAlerta("danger", "Conexión perdida — reconectando..."); });

    socket.on(WS_EVENT, (msg) => {
      const { voltaje, corriente, potencia, fp } = msg;
      const cfg = configRef.current;
      const t   = ahora();

      setDatos({ voltaje, corriente, potencia, fp });
      setHistorico((prev) => {
        const next = [...prev, { time: t, voltaje, corriente, potencia, fp }];
        return next.length > 50 ? next.slice(-50) : next;
      });
      setTabla((prev) => [{ time: t, voltaje, corriente, potencia }, ...prev].slice(0, 8));

      if (calcEstadoP(potencia, cfg) === "danger")    addAlerta("danger", `Potencia crítica: ${potencia}W`);
      else if (calcEstadoP(potencia, cfg) === "warn") addAlerta("warn",   `Potencia elevada: ${potencia}W`);
      if (calcEstadoI(corriente, cfg) !== "normal")   addAlerta("warn",   `Corriente alta: ${corriente}A`);
      if (calcEstadoFP(fp, cfg) !== "normal")         addAlerta("warn",   `Factor de potencia bajo: ${fp}`);
      if (calcEstadoV(voltaje, cfg) !== "normal")     addAlerta("warn",   `Voltaje fuera de rango: ${voltaje}V`);
    });

    fetch(apiPorIntervalo(config.intervaloGrafica))
      .then((r) => r.json())
      .then((data) => {
        setHistorico(data.map((d) => ({ ...d, fp: d.fp ?? 0.9 })));
        setTabla(data.slice(-8).reverse());
        addAlerta("info", `Histórico cargado — ${data.length} registros`);
      })
      .catch(() => addAlerta("warn", "No se pudo cargar el histórico"));

    return () => socket.disconnect();
  }, [loggedIn, addAlerta]);

  // ── Derivados (no son hooks, son cálculos normales) ────
  const T             = TEMAS[config.tema] || TEMAS.oscuro;
  const alertasActivas = alertas.filter((a) => a.tipo === "warn" || a.tipo === "danger");
  const todasTarifas  = [
    ...TARIFAS_PRESET,
    ...(config.tarifaCustomNombre && config.tarifaCustomPrecio
      ? [{ id: "custom", nombre: config.tarifaCustomNombre, precio: parseFloat(config.tarifaCustomPrecio) }]
      : []),
  ];
  const tarifaActiva = todasTarifas.find((t) => t.id === config.tarifaActiva) || TARIFAS_PRESET[0];
  const tabConfig = {
    potencia:  { key: "potencia",  label: "Potencia (W)",  color: T.accent },
    corriente: { key: "corriente", label: "Corriente (A)", color: "#22c55e" },
    voltaje:   { key: "voltaje",   label: "Voltaje (V)",   color: "#3b82f6" },
  };
  const tab = tabConfig[activeTab];

  function exportarCSV() {
    const filas = [
      ["tiempo", "voltaje_V", "corriente_A", "potencia_W"],
      ...tabla.slice(0, config.umbralExport).map((r) => [r.time, r.voltaje, r.corriente, r.potencia]),
    ];
    const blob = new Blob([filas.map((f) => f.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `energia_${Date.now()}.csv`;
    a.click();
  }

  const badge = (estado) => {
    const map = {
      normal: { bg: T.bg3,     color: "#22c55e", border: "#16a34a30" },
      warn:   { bg: "#1a1400", color: "#eab308", border: "#eab30830" },
      danger: { bg: "#1f0a0a", color: "#ef4444", border: "#ef444430" },
    };
    const c = map[estado] || map.normal;
    return { fontSize: 9, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, fontWeight: 500, background: c.bg, color: c.color, border: `1px solid ${c.border}` };
  };

  // ── Render condicional AL FINAL, después de todos los hooks
  if (!loggedIn) {
    return <Login onLogin={(u) => { setLoggedIn(true); setUsuario(u); }} />;
  }

  // ── Render principal ───────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes slideIn { from{transform:translateX(40px);opacity:0} to{transform:translateX(0);opacity:1} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>

      {config.popupAlertas && popup && (alertasActivas.length > 0) &&
        <PopupAlerta alerta={popup} onClose={() => setPopup(null)} T={T} />
      }

      <div style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif", background: T.bg, color: T.text, minHeight: "100vh", display: "flex", flexDirection: "column" }}>

        {/* HEADER */}
        <div style={{ background: T.bg2, borderBottom: `1px solid ${T.border}`, padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 500, letterSpacing: ".5px", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 28, height: 28, background: `linear-gradient(135deg,${T.accent},${T.accent2})`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="12" height="16" viewBox="0 0 12 16" fill="white"><path d="M7 0L0 9h5l-1 7 7-10H6L7 0z"/></svg>
              </div>
              EnergyMonitor
            </div>
            <div style={{ width: 1, height: 20, background: T.border2 }} />
            <span style={{ fontSize: 12, color: T.text2 }}>{config.nombreSistema} · {config.nombreZona}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "monospace", padding: "4px 10px", borderRadius: 20, border: `1px solid ${online ? "#16a34a40" : "#ef444440"}`, background: online ? "#0a1f1040" : "#1f0a0a40", color: online ? "#22c55e" : "#ef4444" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: online ? "#22c55e" : "#ef4444", animation: "pulse 2s infinite" }} />
              WebSocket · {online ? "ONLINE" : "OFFLINE"}
            </div>
            <button onClick={exportarCSV} style={{ background: "transparent", border: `1px solid ${T.border2}`, color: T.text2, fontSize: 11, padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "monospace" }}>
              ↓ Exportar CSV
            </button>
            <span style={{ fontSize: 12, color: T.text2 }}>👤 {usuario}</span>
          </div>
        </div>

        {/* BANNER ALERTA */}
        {alertasActivas.length > 0 && (
          <div style={{ background: "#1a0f00", borderBottom: "1px solid #f97316aa", padding: "6px 20px", fontSize: 12, fontFamily: "monospace", color: "#f97316", display: "flex", alignItems: "center", gap: 8 }}>
            ⚠ {alertasActivas[0].texto}
          </div>
        )}

        <div style={{ display: "flex", flex: 1 }}>

          {/* SIDEBAR */}
          <div style={{ width: 190, background: T.bg2, borderRight: `1px solid ${T.border}`, flexShrink: 0, padding: "16px 0" }}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontFamily: "monospace", color: T.text3, padding: "0 16px 8px", letterSpacing: "1px", textTransform: "uppercase" }}>Monitor</div>
              {[["dashboard","Dashboard","▦"],["historico","Histórico","∿"],["alertas","Alertas","⏰"]].map(([id, nombre, icon]) => (
                <div key={id} onClick={() => setVistaActual(id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", fontSize: 12, cursor: "pointer", color: vistaActual === id ? T.accent : T.text2, background: vistaActual === id ? T.bg3 : "transparent", borderLeft: `2px solid ${vistaActual === id ? T.accent : "transparent"}`, transition: "all .15s" }}>
                  <span style={{ fontSize: 14 }}>{icon}</span> {nombre}
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 10, fontFamily: "monospace", color: T.text3, padding: "0 16px 8px", letterSpacing: "1px", textTransform: "uppercase" }}>Sistema</div>
              <div onClick={() => setVistaActual("config")} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", fontSize: 12, cursor: "pointer", color: vistaActual === "config" ? T.accent : T.text2, background: vistaActual === "config" ? T.bg3 : "transparent", borderLeft: `2px solid ${vistaActual === "config" ? T.accent : "transparent"}`, transition: "all .15s" }}>
                <span style={{ fontSize: 14 }}>⚙</span> Configuración
              </div>
            </div>
          </div>

          {/* CONTENIDO */}
          {vistaActual === "config" ? (
            <VistaConfiguracion config={config} setConfig={setConfig} T={T} />
          ) : (
            <div style={{ flex: 1, padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>

              {/* CARDS */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                {[
                  { label: "Voltaje",        val: datos.voltaje.toFixed(1),   unit: "V",  color: "#3b82f6", estado: calcEstadoV(datos.voltaje, config),  pct: (datos.voltaje / 300) * 100,                        sub: `warn ${config.voltajeWarnMin}–${config.voltajeWarnMax}V` },
                  { label: "Corriente",       val: datos.corriente.toFixed(2), unit: "A",  color: "#22c55e", estado: calcEstadoI(datos.corriente, config), pct: (datos.corriente / config.corrienteDanger) * 100,   sub: `límite ${config.corrienteDanger}A` },
                  { label: "Potencia",        val: datos.potencia.toFixed(0),  unit: "W",  color: T.accent,  estado: calcEstadoP(datos.potencia, config),  pct: (datos.potencia / config.potenciaDanger) * 100,     sub: `warn +${config.potenciaWarn}W` },
                  { label: "Factor Potencia", val: datos.fp.toFixed(2),        unit: "fp", color: "#06b6d4", estado: calcEstadoFP(datos.fp, config),       pct: datos.fp * 100,                                     sub: datos.fp >= 0.9 ? "eficiencia alta" : datos.fp >= 0.8 ? "eficiencia media" : "baja" },
                ].map((c) => (
                  <div key={c.label} style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", inset: 0, opacity: .04, background: c.color, pointerEvents: "none" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <span style={{ fontSize: 11, color: T.text3, fontFamily: "monospace", letterSpacing: ".5px", textTransform: "uppercase" }}>{c.label}</span>
                      <span style={badge(c.estado)}>{c.estado.toUpperCase()}</span>
                    </div>
                    <div>
                      <span style={{ fontSize: 28, fontFamily: "monospace", fontWeight: 500, lineHeight: 1, color: c.color }}>{c.val}</span>
                      <span style={{ fontSize: 13, color: T.text3, marginLeft: 3 }}>{c.unit}</span>
                    </div>
                    <div style={{ fontSize: 11, color: T.text3, fontFamily: "monospace", marginTop: 2 }}>{c.sub}</div>
                    <div style={{ height: 2, background: T.bg4, borderRadius: 2, marginTop: 10, overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 2, width: `${Math.min(c.pct, 100)}%`, background: c.color, transition: "width .5s ease" }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* GRÁFICA */}
              <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <span style={{ fontSize: 12, fontFamily: "monospace", color: T.text2, letterSpacing: ".5px" }}>
                    variables vs tiempo · intervalo: {config.intervaloGrafica}
                  </span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {["potencia","corriente","voltaje"].map((t) => (
                      <div key={t} onClick={() => setActiveTab(t)} style={{ fontSize: 10, fontFamily: "monospace", padding: "3px 8px", borderRadius: 4, cursor: "pointer", border: `1px solid ${activeTab === t ? T.accent : T.border}`, background: activeTab === t ? T.accent : "transparent", color: activeTab === t ? "white" : T.text3, transition: "all .15s" }}>
                        {t}
                      </div>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={historico} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border + "88"} />
                    <XAxis dataKey="time" tick={{ fill: T.text3, fontSize: 9, fontFamily: "monospace" }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: T.text3, fontSize: 9, fontFamily: "monospace" }} tickLine={false} />
                    <Tooltip content={<CustomTooltip temaObj={T} />} />
                    <Line type="monotone" dataKey={tab.key} name={tab.label} stroke={tab.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* FILA INFERIOR */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

                {/* Alertas */}
                <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 12, fontFamily: "monospace", color: T.text2, letterSpacing: ".5px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                    Alertas del sistema
                    <span style={{ background: "#2a1a0a", color: T.accent, fontSize: 9, padding: "2px 6px", borderRadius: 10, border: `1px solid ${T.accent}30` }}>
                      {alertasActivas.length} {alertasActivas.length === 1 ? "activa" : "activas"}
                    </span>
                  </div>
                  {alertas.length === 0 && <p style={{ fontSize: 11, color: T.text3, fontFamily: "monospace" }}>Sin alertas — esperando datos...</p>}
                  {alertas.map((a) => {
                    const cols = { ok: "#22c55e", info: "#3b82f6", warn: "#eab308", danger: "#ef4444" };
                    const c = cols[a.tipo] || cols.info;
                    return (
                      <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px", background: T.bg3, border: `1px solid ${T.border}`, borderLeft: `2px solid ${c}`, borderRadius: 8, fontSize: 11, marginBottom: 6 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: c, flexShrink: 0, marginTop: 2 }} />
                        <span style={{ color: T.text2, lineHeight: 1.4 }}>{a.texto}</span>
                        <span style={{ fontSize: 10, fontFamily: "monospace", color: T.text3, marginLeft: "auto", flexShrink: 0 }}>{a.t}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Tabla + tarifa */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
                    <div style={{ fontSize: 12, fontFamily: "monospace", color: T.text2, letterSpacing: ".5px", marginBottom: 12 }}>Últimas lecturas</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                      <thead>
                        <tr>{["Hora","V","A","W"].map((h) => <th key={h} style={{ color: T.text3, textAlign: "left", padding: "4px 8px", borderBottom: `1px solid ${T.border}`, fontWeight: 400, fontSize: 10, textTransform: "uppercase", letterSpacing: ".5px" }}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {tabla.map((r, i) => (
                          <tr key={i}>
                            <td style={{ padding: "6px 8px", borderBottom: `1px solid ${T.bg3}`, color: T.text2 }}>{r.time}</td>
                            <td style={{ padding: "6px 8px", borderBottom: `1px solid ${T.bg3}`, color: "#3b82f6" }}>{typeof r.voltaje   === "number" ? r.voltaje.toFixed(1)   : r.voltaje}</td>
                            <td style={{ padding: "6px 8px", borderBottom: `1px solid ${T.bg3}`, color: "#22c55e" }}>{typeof r.corriente === "number" ? r.corriente.toFixed(2) : r.corriente}</td>
                            <td style={{ padding: "6px 8px", borderBottom: `1px solid ${T.bg3}`, color: T.accent }}>{typeof r.potencia  === "number" ? r.potencia.toFixed(0)  : r.potencia}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Tarifa activa */}
                  <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 10, fontFamily: "monospace", color: T.text3, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>Tarifa activa</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: T.text2 }}>{tarifaActiva.nombre}</span>
                      <span style={{ fontSize: 18, fontFamily: "monospace", fontWeight: 500, color: T.accent }}>
                        €{tarifaActiva.precio.toFixed(3)}<span style={{ fontSize: 11, color: T.text3 }}>/kWh</span>
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 6, fontFamily: "monospace" }}>
                      Coste estimado: €{((datos.potencia / 1000) * tarifaActiva.precio).toFixed(4)}/h
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}