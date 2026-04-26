import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, fetchAll, insertOne, updateOne, deleteOne, deleteWhere } from "./supabaseClient.js";

// ─── DB TABLE NAMES ───
// Mapping from our client-side state keys to Supabase table names
const TABLES = {
  bikes: "bikes",
  batteries: "batteries",
  checks: "checks",
  faults: "faults",
  services: "services",
  parts: "parts",
  staff: "staff",
};

// ─── FIELD MAPPING ───
// Supabase uses snake_case; our app uses camelCase. These translate both ways.
const fromDb = {
  bikes: (r) => ({
    id: r.id, bikeNumber: r.bike_number, name: r.name, category: r.category, brand: r.brand, model: r.model,
    serial: r.serial, purchaseDate: r.purchase_date, status: r.status,
    conditionScore: r.condition_score, totalKm: r.total_km, totalRides: r.total_rides,
    odometer: r.odometer, sortOrder: r.sort_order ?? 999, batteryId: r.battery_id, lastPreRide: r.last_pre_ride, lastPostRide: r.last_post_ride,
    lastService: r.last_service, notes: r.notes, created: r.created_at,
  }),
  batteries: (r) => ({
    id: r.id, serial: r.serial, purchaseDate: r.purchase_date, status: r.status,
    lastChargeDate: r.last_charge_date, lastIssue: r.last_issue_date, notes: r.notes, created: r.created_at,
  }),
  checks: (r) => ({
    id: r.id, bikeId: r.bike_id, type: r.type, staff: r.staff, toggles: r.toggles,
    result: r.result, notes: r.notes, date: r.date, created: r.created_at,
  }),
  faults: (r) => ({
    id: r.id, bikeId: r.bike_id, reportedBy: r.reported_by, category: r.category,
    code: r.code, severity: r.severity, description: r.description, status: r.status,
    assignedTo: r.assigned_to, resolution: r.resolution, partsUsed: r.parts_used,
    closedDate: r.closed_date, date: r.date, created: r.created_at,
  }),
  services: (r) => ({
    id: r.id, bikeId: r.bike_id, serviceType: r.service_type, dueDate: r.due_date,
    completedDate: r.completed_date, assignedTo: r.assigned_to, tasks: r.tasks,
    workNotes: r.work_notes, partsUsed: r.parts_used || [], timeSpent: r.time_spent,
    outcome: r.outcome, created: r.created_at,
  }),
  parts: (r) => ({
    id: r.id, name: r.name, category: r.category, supplier: r.supplier,
    supplierCode: r.supplier_code, qty: r.qty, reorder: r.reorder, cost: r.cost,
    compatible: r.compatible, notes: r.notes, sortOrder: r.sort_order ?? 999, created: r.created_at,
  }),
  staff: (r) => ({ id: r.id, name: r.name, role: r.role, phone: r.phone, active: r.active }),
};

const toDb = {
  bikes: (o) => ({
    bike_number: o.bikeNumber, name: o.name, category: o.category, brand: o.brand, model: o.model, serial: o.serial,
    purchase_date: o.purchaseDate || null, status: o.status, condition_score: o.conditionScore,
    total_km: o.totalKm, total_rides: o.totalRides, odometer: o.odometer, sort_order: o.sortOrder,
    battery_id: o.batteryId || null,
    last_pre_ride: o.lastPreRide || null, last_post_ride: o.lastPostRide || null,
    last_service: o.lastService || null, notes: o.notes,
  }),
  batteries: (o) => ({
    serial: o.serial, purchase_date: o.purchaseDate || null, status: o.status,
    last_charge_date: o.lastChargeDate || null, last_issue_date: o.lastIssue || null, notes: o.notes,
  }),
  checks: (o) => ({
    bike_id: o.bikeId, type: o.type, staff: o.staff, toggles: o.toggles,
    result: o.result, notes: o.notes, date: o.date || new Date().toISOString(),
  }),
  faults: (o) => ({
    bike_id: o.bikeId, reported_by: o.reportedBy, category: o.category, code: o.code,
    severity: o.severity, description: o.description, status: o.status,
    assigned_to: o.assignedTo || null, resolution: o.resolution, parts_used: o.partsUsed,
    closed_date: o.closedDate || null, date: o.date || new Date().toISOString(),
  }),
  services: (o) => ({
    bike_id: o.bikeId, service_type: o.serviceType, due_date: o.dueDate || null,
    completed_date: o.completedDate || null, assigned_to: o.assignedTo, tasks: o.tasks,
    work_notes: o.workNotes, parts_used: o.partsUsed || [], time_spent: o.timeSpent,
    outcome: o.outcome,
  }),
  parts: (o) => ({
    name: o.name, category: o.category, supplier: o.supplier, supplier_code: o.supplierCode,
    qty: o.qty, reorder: o.reorder, cost: o.cost, compatible: o.compatible, notes: o.notes, sort_order: o.sortOrder,
  }),
  staff: (o) => ({ name: o.name, role: o.role, phone: o.phone, active: o.active }),
};

// ─── ID GENERATORS ───
const now = () => new Date().toISOString();
// Client-side temp ID (stripped by update() on insert; Supabase assigns real uuid)
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
};
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

// ─── CONSTANTS ───
const BIKE_STATUSES = ["Ready", "Needs Check", "Monitor", "Service Due", "Out of Service"];
const BIKE_CATEGORIES = ["Fat Tyre Cruiser", "Vallkree Warchild", "Vallkree Moondog", "Higgs Teen", "NCM Milano", "Cargo Bike", "Kids", "Trike"];
const CHECK_ITEMS_PRE = ["tyres", "brakes", "tyrePressure", "screen", "seat", "batteryFullCharge", "boxCleanPosition", "chainLubed", "damage", "keys", "lockInBike", "helmetClean", "bikeClean"];
const CHECK_LABELS = {
  tyres: "Tyres OK", brakes: "Brakes OK", tyrePressure: "Tyre Pressure", screen: "Screen",
  seat: "Seat Secure", batteryFullCharge: "Battery Full Charge", boxCleanPosition: "Box Clean & In Position",
  chainLubed: "Chain Lubed", damage: "Damage Visible", keys: "Keys Present",
  lockInBike: "Lock In Bike", helmetClean: "Helmet Clean", bikeClean: "Bike Clean",
  brakePerf: "Brake Performance", gearPerf: "Gear Performance", tyreIssues: "Tyre Issues",
  batteryLevel: "Battery Level", customerIssue: "Customer Reported Issue", cleanDone: "Clean Completed",
};
const CHECK_ITEMS_POST = ["damage", "brakePerf", "gearPerf", "tyreIssues", "batteryLevel", "customerIssue", "cleanDone"];
const PRE_RESULTS = ["Passed", "Passed with Monitor Note", "Failed"];
const POST_RESULTS = ["Ready", "Monitor", "Needs Service", "Out of Service"];
const FAULT_CATEGORIES = ["Brakes", "Tyres", "Wheels", "Drivetrain", "Battery", "Motor", "Display/Controls", "Frame/Structure", "Light", "Bell", "Accessories", "Cosmetic", "Other"];
const FAULT_SEVERITY = ["Monitor", "Service Required", "Critical"];
const FAULT_STATUS = ["Open", "In Progress", "Waiting Parts", "Resolved", "Closed"];
const BATTERY_STATUSES = ["Active", "Monitor", "Service Due", "Retired"];
const SERVICE_TYPES = ["Weekly Check", "Monthly Service", "Major Service", "Repair Job", "Battery Inspection"];
const PART_CATEGORIES = ["Tubes", "Tyres", "Brake pads", "Chains", "Cassettes", "Rotors", "Hangers", "Keys", "Chargers", "Cables", "Bearings", "Lights", "Bells", "Grips", "Pedals", "Misc consumables", "Other"];

const FAULT_CODES = {
  Brakes: [["BRK-01", "Pad worn"], ["BRK-02", "Rotor rub"], ["BRK-03", "Weak braking"], ["BRK-04", "Lever issue"]],
  Tyres: [["TYR-01", "Low pressure"], ["TYR-02", "Puncture"], ["TYR-03", "Sidewall damage"], ["TYR-04", "Worn tread"]],
  Wheels: [["WHL-01", "Spoke loose"], ["WHL-02", "Rim damage"], ["WHL-03", "Hub issue"], ["WHL-04", "Quick release"]],
  Drivetrain: [["DRV-01", "Chain wear"], ["DRV-02", "Gear slip"], ["DRV-03", "Derailleur issue"], ["DRV-04", "Noise"]],
  Battery: [["BAT-01", "Not charging"], ["BAT-02", "Loose fit"], ["BAT-03", "Power cutout"], ["BAT-04", "Range complaint"]],
  Motor: [["ELE-01", "Display issue"], ["ELE-02", "Motor assist failure"], ["ELE-03", "Cable issue"], ["ELE-04", "Error code"]],
  "Display/Controls": [["ELE-01", "Display issue"], ["ELE-02", "Motor assist failure"], ["ELE-03", "Cable issue"], ["ELE-04", "Error code"]],
  "Frame/Structure": [["STR-01", "Loose headset"], ["STR-02", "Wheel play"], ["STR-03", "Rack loose"], ["STR-04", "Frame concern"]],
  Light: [["LGT-01", "Front light not working"], ["LGT-02", "Rear light not working"], ["LGT-03", "Loose / hanging"], ["LGT-04", "Missing"], ["LGT-05", "Flat battery"]],
  Bell: [["BEL-01", "Not ringing"], ["BEL-02", "Loose"], ["BEL-03", "Missing"], ["BEL-04", "Damaged"]],
  Accessories: [["ACC-01", "Missing"], ["ACC-02", "Broken"], ["ACC-03", "Loose"]],
  Cosmetic: [["COS-01", "Scratch"], ["COS-02", "Dent"], ["COS-03", "Paint chip"]],
  Other: [["OTH-01", "Other"]],
};

const STATUS_COLORS = {
  Ready: "#22c55e",
  "Needs Check": "#f59e0b",
  Monitor: "#3b82f6",
  "Service Due": "#a855f7",
  "Out of Service": "#ef4444",
};

// ─── STYLES ───
const FONT = `'DM Sans', system-ui, sans-serif`;
const MONO = `'DM Mono', 'SF Mono', monospace`;
const C = {
  bg: "#0f1117",
  surface: "#1a1d27",
  surfaceHover: "#22262f",
  border: "#2a2e3a",
  borderLight: "#353a48",
  text: "#e8e9ed",
  textMuted: "#8b8fa3",
  accent: "#f97316",
  accentDark: "#c2410c",
  accentGlow: "rgba(249,115,22,0.15)",
  green: "#22c55e",
  greenBg: "rgba(34,197,94,0.12)",
  yellow: "#f59e0b",
  yellowBg: "rgba(245,158,11,0.12)",
  blue: "#3b82f6",
  blueBg: "rgba(59,130,246,0.12)",
  purple: "#a855f7",
  purpleBg: "rgba(168,85,247,0.12)",
  red: "#ef4444",
  redBg: "rgba(239,68,68,0.12)",
};

const base = {
  fontFamily: FONT,
  color: C.text,
  boxSizing: "border-box",
};

const s = {
  app: { ...base, background: C.bg, minHeight: "100vh", maxWidth: 1200, margin: "0 auto", padding: "0 16px 80px" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 0", borderBottom: `1px solid ${C.border}`, marginBottom: 20 },
  logo: { fontFamily: MONO, fontSize: 13, fontWeight: 700, color: C.accent, letterSpacing: 2, textTransform: "uppercase" },
  nav: { display: "flex", gap: 4, flexWrap: "wrap" },
  navBtn: (active) => ({
    ...base, background: active ? C.accentGlow : "transparent", color: active ? C.accent : C.textMuted,
    border: active ? `1px solid ${C.accent}33` : "1px solid transparent", borderRadius: 8,
    padding: "7px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", transition: "all .15s",
  }),
  h1: { fontSize: 22, fontWeight: 700, margin: "0 0 16px", letterSpacing: -0.5 },
  h2: { fontSize: 17, fontWeight: 600, margin: "0 0 12px", letterSpacing: -0.3 },
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 12 },
  cardSm: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" },
  grid: (cols) => ({ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 }),
  statCard: (color, bg) => ({
    background: bg, border: `1px solid ${color}22`, borderRadius: 10, padding: "16px 18px",
    display: "flex", flexDirection: "column", gap: 4,
  }),
  statNum: (color) => ({ fontSize: 28, fontWeight: 800, color, letterSpacing: -1, fontFamily: MONO }),
  statLabel: { fontSize: 12, fontWeight: 500, color: C.textMuted, textTransform: "uppercase", letterSpacing: 1 },
  btn: (variant = "primary") => ({
    ...base, display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 8,
    fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "all .15s", border: "none",
    ...(variant === "primary" ? { background: C.accent, color: "#fff" } :
      variant === "danger" ? { background: C.red, color: "#fff" } :
      variant === "ghost" ? { background: "transparent", color: C.textMuted, border: `1px solid ${C.border}` } :
      { background: C.surfaceHover, color: C.text, border: `1px solid ${C.border}` }),
  }),
  input: {
    ...base, width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`,
    background: C.bg, fontSize: 14, color: C.text, outline: "none",
  },
  select: {
    ...base, width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`,
    background: C.bg, fontSize: 14, color: C.text, outline: "none", appearance: "none",
  },
  label: { fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4, display: "block" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "10px 12px", borderBottom: `1px solid ${C.border}`, color: C.textMuted, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 },
  td: { padding: "10px 12px", borderBottom: `1px solid ${C.border}11` },
  badge: (color) => ({
    display: "inline-block", padding: "3px 10px", borderRadius: 50, fontSize: 11, fontWeight: 600,
    background: color + "18", color, border: `1px solid ${color}33`,
  }),
  toggle: (on) => ({
    width: 44, height: 26, borderRadius: 13, border: "none", cursor: "pointer",
    background: on ? C.green : C.border, position: "relative", transition: "background .2s",
  }),
  toggleDot: (on) => ({
    width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute",
    top: 3, left: on ? 21 : 3, transition: "left .2s",
  }),
  modal: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.7)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
  },
  modalContent: {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24,
    maxWidth: 560, width: "100%", maxHeight: "85vh", overflowY: "auto",
  },
  mobileNav: {
    position: "fixed", bottom: 0, left: 0, right: 0, background: C.surface,
    borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-around",
    padding: "8px 0 env(safe-area-inset-bottom, 8px)", zIndex: 999,
  },
  mobileNavBtn: (active) => ({
    ...base, background: "transparent", border: "none", color: active ? C.accent : C.textMuted,
    fontSize: 10, fontWeight: 600, cursor: "pointer", display: "flex", flexDirection: "column",
    alignItems: "center", gap: 2, padding: "4px 8px",
  }),
};

// ─── ICONS (simple SVG) ───
const Icon = ({ d, size = 18, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const Icons = {
  dashboard: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1",
  bike: "M5 17a3 3 0 100-6 3 3 0 000 6zm14 0a3 3 0 100-6 3 3 0 000 6zM5 14l4-7h6l2 3.5M15 10.5L19 14",
  check: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  fault: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  battery: "M17 6h-2V4H9v2H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V8a2 2 0 00-2-2z",
  parts: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  service: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  plus: "M12 4v16m8-8H4",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  x: "M6 18L18 6M6 6l12 12",
  back: "M15 19l-7-7 7-7",
  save: "M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4",
  chart: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  download: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4",
};

// ─── FORM FIELD ───
const Field = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={s.label}>{label}</label>
    {children}
  </div>
);

const Select = ({ value, onChange, options, placeholder }) => (
  <div style={{ position: "relative" }}>
    <select style={s.select} value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={typeof o === "string" ? o : o[0]} value={typeof o === "string" ? o : o[0]}>{typeof o === "string" ? o : `${o[0]} — ${o[1]}`}</option>)}
    </select>
    <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: C.textMuted }}>▾</span>
  </div>
);

const Toggle = ({ value, onChange, label }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" }}>
    <span style={{ fontSize: 14, color: C.text }}>{label}</span>
    <button style={s.toggle(value)} onClick={() => onChange(!value)}>
      <div style={s.toggleDot(value)} />
    </button>
  </div>
);

// ─── STATUS BADGE ───
const StatusBadge = ({ status }) => (
  <span style={s.badge(STATUS_COLORS[status] || C.textMuted)}>{status}</span>
);

// ─── PIN GATE ───
const APP_PIN = "2025"; // Change this to your preferred PIN

function PinScreen({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  const handleSubmit = () => {
    if (pin === APP_PIN) {
      sessionStorage.setItem("fleet-unlocked", "true");
      onUnlock();
    } else {
      setError(true);
      setShake(true);
      setPin("");
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <div style={{
      ...base, background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", flexDirection: "column", padding: 20,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>⚡</div>
        <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.accent, letterSpacing: 2, textTransform: "uppercase" }}>Fleet Manager</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>Valley E-Bikes</div>
      </div>
      <div style={{
        ...s.card, maxWidth: 320, width: "100%", textAlign: "center",
        animation: shake ? "shake 0.4s ease" : "none",
      }}>
        <style>{`@keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)} }`}</style>
        <div style={{ ...s.label, marginBottom: 12, textAlign: "center" }}>Enter PIN to continue</div>
        <input
          style={{ ...s.input, textAlign: "center", fontSize: 24, fontFamily: MONO, letterSpacing: 12 }}
          type="password"
          maxLength={8}
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
          placeholder="••••"
          autoFocus
        />
        {error && <div style={{ color: C.red, fontSize: 12, marginTop: 8 }}>Wrong PIN. Try again.</div>}
        <button style={{ ...s.btn("primary"), width: "100%", justifyContent: "center", marginTop: 16 }} onClick={handleSubmit}>
          Unlock
        </button>
      </div>
    </div>
  );
}

// ─── MAIN APP ───
export default function FleetManager() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem("fleet-unlocked") === "true");

  if (!unlocked) {
    return <PinScreen onUnlock={() => setUnlocked(true)} />;
  }

  return <FleetManagerApp />;
}

function FleetManagerApp() {
  const [state, setState] = useState({ bikes: [], batteries: [], checks: [], faults: [], services: [], parts: [], staff: [] });
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [selectedBike, setSelectedBike] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  // ─── INITIAL LOAD FROM SUPABASE ───
  useEffect(() => {
    (async () => {
      try {
        const [bikes, batteries, checks, faults, services, parts, staff] = await Promise.all([
          fetchAll("bikes"), fetchAll("batteries"), fetchAll("checks"),
          fetchAll("faults"), fetchAll("services"), fetchAll("parts"), fetchAll("staff"),
        ]);
        setState({
          bikes: bikes.map(fromDb.bikes),
          batteries: batteries.map(fromDb.batteries),
          checks: checks.map(fromDb.checks),
          faults: faults.map(fromDb.faults),
          services: services.map(fromDb.services),
          parts: parts.map(fromDb.parts),
          staff: staff.map(fromDb.staff),
        });
      } catch (e) {
        console.error("Initial load failed:", e);
        setSyncError(e.message || "Failed to connect to database");
      } finally {
        setLoading(false);
      }
    })();

    // Real-time subscriptions — any device sees changes instantly
    const channel = supabase.channel("fleet-changes");
    ["bikes", "batteries", "checks", "faults", "services", "parts"].forEach((t) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table: t }, async () => {
        const rows = await fetchAll(t);
        setState((prev) => ({ ...prev, [t]: rows.map(fromDb[t]) }));
      });
    });
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ─── UPDATE HELPER ───
  // This keeps backward-compatibility with how the rest of the app calls update().
  // Inspects returned array vs previous to detect adds/updates/deletes and persists to Supabase.
  // Client-generated IDs (like "BK-xyz") are stripped; Supabase assigns real UUIDs, then we refetch.
  const update = useCallback((key, fn) => {
    setState((prev) => {
      const prevList = prev[key] || [];
      const nextList = fn(prevList);
      const table = TABLES[key];
      if (!table) return { ...prev, [key]: nextList };

      const prevById = new Map(prevList.map((r) => [r.id, r]));
      const nextById = new Map(nextList.map((r) => [r.id, r]));

      const refresh = async () => {
        const rows = await fetchAll(table);
        setState((p) => ({ ...p, [key]: rows.map(fromDb[key]) }));
      };

      let needsRefresh = false;

      nextList.forEach((row) => {
        const isClientId = row.id && typeof row.id === "string" && row.id.includes("-") && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id);
        if (!row.id || isClientId || !prevById.has(row.id)) {
          // INSERT — strip client-side id, let Supabase generate uuid
          const { id, ...rest } = row;
          const dbRow = toDb[key](rest);
          needsRefresh = true;
          insertOne(table, dbRow).catch((err) => setSyncError(`Insert failed: ${err.message}`));
        } else {
          const prevRow = prevById.get(row.id);
          if (JSON.stringify(prevRow) !== JSON.stringify(row)) {
            const dbRow = toDb[key](row);
            updateOne(table, row.id, dbRow).catch((err) => setSyncError(`Update failed: ${err.message}`));
          }
        }
      });

      prevList.forEach((row) => {
        if (row.id && !nextById.has(row.id)) {
          const isClientId = typeof row.id === "string" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id);
          if (!isClientId) {
            deleteOne(table, row.id).catch((err) => setSyncError(`Delete failed: ${err.message}`));
          }
        }
      });

      if (needsRefresh) {
        // Refetch in ~300ms so new rows have proper UUIDs
        setTimeout(refresh, 350);
      }

      return { ...prev, [key]: nextList };
    });
  }, []);

  const { bikes, checks, faults, services, batteries, parts, staff } = state;

  // ─── DASHBOARD STATS ───
  const stats = useMemo(() => {
    const openFaults = faults.filter((f) => f.status === "Open" || f.status === "In Progress");
    const batteryAlerts = batteries.filter((b) => b.status !== "Active");
    const lowParts = parts.filter((p) => p.qty <= p.reorder);
    const today = new Date().toDateString();
    const todayFaults = faults.filter((f) => new Date(f.date).toDateString() === today && (f.status === "Open" || f.status === "In Progress"));
    // Recurring: bikes with 3+ faults in 30 days
    const thirtyDaysAgo = Date.now() - 30 * 86400000;
    const faultCounts = {};
    faults.filter((f) => new Date(f.date).getTime() > thirtyDaysAgo).forEach((f) => { faultCounts[f.bikeId] = (faultCounts[f.bikeId] || 0) + 1; });
    const recurringBikes = Object.entries(faultCounts).filter(([, c]) => c >= 3).map(([id]) => id);

    return {
      total: bikes.length,
      ready: bikes.filter((b) => b.status === "Ready").length,
      needsCheck: bikes.filter((b) => b.status === "Needs Check").length,
      serviceDue: bikes.filter((b) => b.status === "Service Due").length,
      oos: bikes.filter((b) => b.status === "Out of Service").length,
      monitor: bikes.filter((b) => b.status === "Monitor").length,
      openFaults: openFaults.length,
      todayFaults: todayFaults.length,
      batteryAlerts: batteryAlerts.length,
      lowParts,
      recurringBikes,
      topFaultBikes: Object.entries(faultCounts).sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  }, [bikes, faults, batteries, parts]);

  // ─── ADD BIKE ───
  const addBike = (data) => {
    update("bikes", (prev) => [...prev, { ...data, id: uid("BK"), status: "Needs Check", conditionScore: 10, totalKm: 0, totalRides: 0, openFaults: 0, created: now() }]);
    setModal(null);
  };

  // ─── ADD BATTERY ───
  const addBattery = (data) => {
    update("batteries", (prev) => [...prev, { ...data, id: uid("BAT"), status: "Active", created: now() }]);
    setModal(null);
  };

  // ─── SUBMIT CHECK ───
  const submitCheck = (data) => {
    const checkRecord = { ...data, id: uid("CHK"), date: now() };
    update("checks", (prev) => [...prev, checkRecord]);

    // Build bike update patch
    const odometerPatch = data.odometer ? { odometer: data.odometer } : {};

    // Auto-status logic
    if (data.type === "pre-ride") {
      if (data.result === "Failed") {
        update("bikes", (prev) => prev.map((b) => b.id === data.bikeId ? { ...b, status: "Out of Service", lastPreRide: now(), ...odometerPatch } : b));
        // Auto-create fault
        update("faults", (prev) => [...prev, {
          id: uid("FLT"), bikeId: data.bikeId, date: now(), reportedBy: data.staff,
          category: "Other", code: "OTH-01", severity: "Service Required",
          description: "Auto-created from failed pre-ride check", status: "Open",
          assignedTo: "", resolution: "", partsUsed: "", closedDate: "",
        }]);
      } else {
        update("bikes", (prev) => prev.map((b) => b.id === data.bikeId ? { ...b, status: data.result === "Passed with Monitor Note" ? "Monitor" : "Ready", lastPreRide: now(), ...odometerPatch } : b));
      }
    } else {
      const statusMap = { Ready: "Ready", Monitor: "Monitor", "Needs Service": "Service Due", "Out of Service": "Out of Service" };
      update("bikes", (prev) => prev.map((b) => b.id === data.bikeId ? { ...b, status: statusMap[data.result] || b.status, lastPostRide: now() } : b));
    }
    setModal(null);
  };

  // ─── SUBMIT FAULT ───
  const submitFault = (data) => {
    update("faults", (prev) => [...prev, { ...data, id: uid("FLT"), date: now(), status: "Open", closedDate: "" }]);
    if (data.severity === "Critical") {
      update("bikes", (prev) => prev.map((b) => b.id === data.bikeId ? { ...b, status: "Out of Service" } : b));
    } else if (data.severity === "Service Required") {
      update("bikes", (prev) => prev.map((b) => b.id === data.bikeId ? { ...b, status: "Service Due" } : b));
    }
    setModal(null);
  };

  // ─── RESOLVE FAULT ───
  const resolveFault = (faultId, notes, partsUsed) => {
    update("faults", (prev) => prev.map((f) => f.id === faultId ? { ...f, status: "Resolved", resolution: notes, partsUsed, closedDate: now() } : f));
  };

  // ─── NAV PAGES ───
  const pages = [
    ["dashboard", "Dashboard", Icons.dashboard],
    ["bikes", "Fleet", Icons.bike],
    ["checks", "Checks", Icons.check],
    ["faults", "Faults", Icons.fault],
    ["services", "Services", Icons.service],
    ["batteries", "Batteries", Icons.battery],
    ["parts", "Parts", Icons.parts],
    ["reports", "Reports", Icons.chart],
  ];

  // ─── RENDER ───
  if (loading) {
    return (
      <div style={{ ...s.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <div style={{ textAlign: "center" }}>
          <div style={{ ...s.logo, fontSize: 16, marginBottom: 8 }}>⚡ Fleet Manager</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>Loading fleet data…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.app}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      {syncError && (
        <div style={{ background: C.redBg, border: `1px solid ${C.red}44`, borderRadius: 8, padding: 10, margin: "10px 0", fontSize: 12, color: C.red, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>⚠ Sync issue: {syncError}</span>
          <button style={{ ...s.btn("ghost"), padding: "2px 8px", fontSize: 11 }} onClick={() => setSyncError(null)}>Dismiss</button>
        </div>
      )}
      {/* HEADER */}
      <header style={s.header}>
        <div>
          <div style={s.logo}>⚡ Fleet Manager</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Valley E-Bikes</div>
        </div>
        <nav style={s.nav}>
          {pages.map(([key, label]) => (
            <button key={key} style={s.navBtn(page === key)} onClick={() => { setPage(key); setSelectedBike(null); setSearchTerm(""); }}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      {/* PAGES */}
      {page === "dashboard" && <DashboardPage stats={stats} bikes={bikes} faults={faults} parts={parts} setPage={setPage} setSelectedBike={setSelectedBike} />}
      {page === "bikes" && <BikesPage bikes={bikes} faults={faults} batteries={batteries} searchTerm={searchTerm} setSearchTerm={setSearchTerm} selectedBike={selectedBike} setSelectedBike={setSelectedBike} setModal={setModal} update={update} checks={checks} />}
      {page === "checks" && <ChecksPage checks={checks} bikes={bikes} setModal={setModal} />}
      {page === "faults" && <FaultsPage faults={faults} bikes={bikes} staff={staff} setModal={setModal} resolveFault={resolveFault} update={update} />}
      {page === "services" && <ServicesPage services={services} bikes={bikes} parts={parts} setModal={setModal} update={update} />}
      {page === "batteries" && <BatteriesPage batteries={batteries} bikes={bikes} setModal={setModal} update={update} />}
      {page === "parts" && <PartsPage parts={parts} update={update} />}
      {page === "reports" && <ReportsPage bikes={bikes} checks={checks} faults={faults} services={services} batteries={batteries} parts={parts} />}

      {/* MODALS */}
      {modal === "addBike" && <AddBikeModal onSubmit={addBike} onClose={() => setModal(null)} batteries={batteries} />}
      {modal === "editBike" && selectedBike && <AddBikeModal
        onSubmit={(data) => { update("bikes", (prev) => prev.map((b) => b.id === selectedBike ? { ...b, ...data } : b)); setModal(null); }}
        onClose={() => setModal(null)}
        batteries={batteries}
        existing={bikes.find((b) => b.id === selectedBike)}
      />}
      {modal === "deleteBike" && selectedBike && <ConfirmModal
        title="Delete bike?"
        message={`This will permanently remove ${bikes.find((b) => b.id === selectedBike)?.name || selectedBike} and all its checks, faults, and service records.`}
        onConfirm={() => {
          update("bikes", (prev) => prev.filter((b) => b.id !== selectedBike));
          update("checks", (prev) => prev.filter((c) => c.bikeId !== selectedBike));
          update("faults", (prev) => prev.filter((f) => f.bikeId !== selectedBike));
          update("services", (prev) => prev.filter((sv) => sv.bikeId !== selectedBike));
          setSelectedBike(null);
          setModal(null);
        }}
        onClose={() => setModal(null)}
      />}
      {modal === "addBattery" && <AddBatteryModal onSubmit={addBattery} onClose={() => setModal(null)} />}
      {modal === "preRide" && <CheckModal type="pre-ride" bikes={bikes.filter((b) => b.status !== "Out of Service")} staff={staff} onSubmit={submitCheck} onClose={() => setModal(null)} preselect={selectedBike} />}
      {modal === "postRide" && <CheckModal type="post-ride" bikes={bikes} staff={staff} onSubmit={submitCheck} onClose={() => setModal(null)} preselect={selectedBike} />}
      {modal === "reportFault" && <FaultModal bikes={bikes} staff={staff} onSubmit={submitFault} onClose={() => setModal(null)} preselect={selectedBike} />}
      {modal === "addService" && <ServiceModal bikes={bikes} staff={staff} onSubmit={(data) => { update("services", (prev) => [...prev, { ...data, id: uid("SVC"), created: now() }]); setModal(null); }} onClose={() => setModal(null)} />}

      {/* MOBILE BOTTOM NAV */}
      <div style={s.mobileNav}>
        {[["dashboard", "Home", Icons.dashboard], ["bikes", "Fleet", Icons.bike], ["preRide", "Pre-Ride", Icons.check], ["postRide", "Post-Ride", Icons.save], ["reportFault", "Fault", Icons.fault]].map(([key, label, icon]) => (
          <button key={key} style={s.mobileNavBtn(page === key)}
            onClick={() => { if (key === "preRide" || key === "postRide" || key === "reportFault") { setModal(key); } else { setPage(key); } }}>
            <Icon d={icon} size={20} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// DASHBOARD PAGE
// ═══════════════════════════════════════════════
function DashboardPage({ stats, bikes, faults, parts, setPage, setSelectedBike }) {
  return (
    <div>
      <h1 style={s.h1}>Dashboard</h1>
      <div style={{ ...s.grid(3), marginBottom: 20 }}>
        <div style={s.statCard(C.green, C.greenBg)}>
          <span style={s.statNum(C.green)}>{stats.ready}</span>
          <span style={s.statLabel}>Ready</span>
        </div>
        <div style={s.statCard(C.yellow, C.yellowBg)}>
          <span style={s.statNum(C.yellow)}>{stats.needsCheck}</span>
          <span style={s.statLabel}>Needs Check</span>
        </div>
        <div style={s.statCard(C.purple, C.purpleBg)}>
          <span style={s.statNum(C.purple)}>{stats.serviceDue}</span>
          <span style={s.statLabel}>Service Due</span>
        </div>
        <div style={s.statCard(C.red, C.redBg)}>
          <span style={s.statNum(C.red)}>{stats.oos}</span>
          <span style={s.statLabel}>Out of Service</span>
        </div>
        <div style={s.statCard(C.blue, C.blueBg)}>
          <span style={s.statNum(C.blue)}>{stats.openFaults}</span>
          <span style={s.statLabel}>Open Faults</span>
        </div>
        <div style={s.statCard(C.accent, C.accentGlow)}>
          <span style={s.statNum(C.accent)}>{stats.total}</span>
          <span style={s.statLabel}>Total Fleet</span>
        </div>
      </div>

      {/* Alerts */}
      {(stats.recurringBikes.length > 0 || stats.lowParts.length > 0 || stats.batteryAlerts > 0) && (
        <div style={{ ...s.card, borderColor: C.red + "44", background: C.redBg }}>
          <h2 style={{ ...s.h2, color: C.red }}>⚠ Alerts</h2>
          {stats.recurringBikes.length > 0 && (
            <div style={{ marginBottom: 8, fontSize: 13 }}>
              <strong>Recurring fault bikes (3+ in 30 days):</strong>{" "}
              {stats.recurringBikes.map((id) => {
                const bike = bikes.find((b) => b.id === id);
                return bike ? bike.name || bike.id : id;
              }).join(", ")}
            </div>
          )}
          {stats.lowParts.length > 0 && (
            <div style={{ marginBottom: 8, fontSize: 13 }}>
              <strong>Low stock:</strong> {stats.lowParts.map((p) => `${p.name} (${p.qty} left)`).join(", ")}
            </div>
          )}
          {stats.batteryAlerts > 0 && (
            <div style={{ fontSize: 13 }}><strong>{stats.batteryAlerts} battery alert{stats.batteryAlerts > 1 ? "s" : ""}</strong></div>
          )}
        </div>
      )}

      {/* Bikes needing attention */}
      <div style={s.card}>
        <h2 style={s.h2}>Bikes Needing Attention</h2>
        {bikes.filter((b) => b.status !== "Ready").length === 0 ? (
          <div style={{ color: C.green, fontSize: 14 }}>✓ All bikes ready</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {bikes.filter((b) => b.status !== "Ready").map((b) => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.border}11`, cursor: "pointer" }}
                onClick={() => { setPage("bikes"); setSelectedBike(b.id); }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{b.name || b.id}</span>
                <StatusBadge status={b.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent faults */}
      <div style={s.card}>
        <h2 style={s.h2}>Recent Faults</h2>
        {faults.length === 0 ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>No faults logged yet</div>
        ) : (
          faults.slice(-5).reverse().map((f) => (
            <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 13 }}>
              <span>{bikes.find((b) => b.id === f.bikeId)?.name || f.bikeId} — {f.category} {f.code}</span>
              <span style={s.badge(f.status === "Open" ? C.red : f.status === "In Progress" ? C.yellow : C.green)}>{f.status}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── DRAG AND DROP REORDER ───
const DragHandle = () => (
  <span style={{ cursor: "grab", color: C.textMuted, fontSize: 16, lineHeight: 1, userSelect: "none", padding: "0 4px" }} title="Drag to reorder">⠿</span>
);

function useDragReorder(items, key, update) {
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const onDragStart = (idx) => (e) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (idx) => (e) => {
    e.preventDefault();
    setOverIdx(idx);
  };
  const onDrop = (idx) => (e) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    const reordered = [...items];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    // Assign sort_order to each item
    const updated = reordered.map((item, i) => ({ ...item, sortOrder: i }));
    update(key, () => updated);
    setDragIdx(null);
    setOverIdx(null);
  };
  const onDragEnd = () => { setDragIdx(null); setOverIdx(null); };

  return { dragIdx, overIdx, onDragStart, onDragOver, onDrop, onDragEnd };
}

// ═══════════════════════════════════════════════
// BIKES PAGE
// ═══════════════════════════════════════════════
function BikesPage({ bikes, faults, batteries, searchTerm, setSearchTerm, selectedBike, setSelectedBike, setModal, update, checks }) {
  const sorted = [...bikes].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
  const filtered = sorted.filter((b) => {
    const term = searchTerm.toLowerCase();
    return !term || b.name?.toLowerCase().includes(term) || b.id.toLowerCase().includes(term) || b.category?.toLowerCase().includes(term) || b.bikeNumber?.toLowerCase().includes(term);
  });
  const { dragIdx, overIdx, onDragStart, onDragOver, onDrop, onDragEnd } = useDragReorder(filtered, "bikes", update);

  const bike = selectedBike ? bikes.find((b) => b.id === selectedBike) : null;

  if (bike) {
    const bikeFaults = faults.filter((f) => f.bikeId === bike.id);
    const bikeChecks = checks.filter((c) => c.bikeId === bike.id);
    const bat = batteries.find((b) => b.id === bike.batteryId);
    return (
      <div>
        <button style={s.btn("ghost")} onClick={() => setSelectedBike(null)}>
          <Icon d={Icons.back} size={16} /> Back to Fleet
        </button>
        <div style={{ ...s.card, marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontFamily: MONO, fontSize: 13, color: C.accent, fontWeight: 700, marginBottom: 2 }}>Bike #{bike.bikeNumber || "—"}</div>
              <h1 style={{ ...s.h1, marginBottom: 4 }}>{bike.name || bike.id}</h1>
              <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 10 }}>{bike.category} • {bike.brand} {bike.model}</div>
            </div>
            <StatusBadge status={bike.status} />
          </div>
          <div style={{ ...s.grid(2), marginTop: 12 }}>
            <div><span style={s.label}>Bike Number</span><div style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, color: C.accent }}>{bike.bikeNumber || "—"}</div></div>
            <div><span style={s.label}>Odometer</span><div style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO }}>{bike.odometer ? `${bike.odometer.toLocaleString()} km` : "—"}</div></div>
            <div><span style={s.label}>Serial</span><div style={{ fontSize: 13 }}>{bike.serial || "—"}</div></div>
            <div><span style={s.label}>Purchased</span><div style={{ fontSize: 13 }}>{fmtDate(bike.purchaseDate)}</div></div>
            <div><span style={s.label}>Total Rides</span><div style={{ fontSize: 13 }}>{bike.totalRides || 0}</div></div>
            <div><span style={s.label}>Est. KM</span><div style={{ fontSize: 13 }}>{bike.totalKm || 0}</div></div>
            <div><span style={s.label}>Condition</span><div style={{ fontSize: 13 }}>{bike.conditionScore}/10</div></div>
            <div><span style={s.label}>Battery</span><div style={{ fontSize: 13 }}>{bat ? bat.id : bike.batteryId || "—"}</div></div>
            <div><span style={s.label}>Last Pre-Ride</span><div style={{ fontSize: 13 }}>{fmtDateTime(bike.lastPreRide)}</div></div>
            <div><span style={s.label}>Last Post-Ride</span><div style={{ fontSize: 13 }}>{fmtDateTime(bike.lastPostRide)}</div></div>
          </div>
          {bike.notes && <div style={{ marginTop: 12, padding: 12, background: C.bg, borderRadius: 8, fontSize: 13 }}>{bike.notes}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button style={s.btn("primary")} onClick={() => setModal("preRide")}>Pre-Ride Check</button>
            <button style={s.btn("secondary")} onClick={() => setModal("postRide")}>Post-Ride Check</button>
            <button style={s.btn("danger")} onClick={() => setModal("reportFault")}>Report Fault</button>
            <button style={s.btn("ghost")} onClick={() => setModal("editBike")}>✎ Edit Details</button>
            <button style={s.btn("ghost")} onClick={() => setModal("deleteBike")}>🗑 Delete</button>
          </div>
        </div>

        {/* Fault history */}
        <div style={s.card}>
          <h2 style={s.h2}>Fault History ({bikeFaults.length})</h2>
          {bikeFaults.length === 0 ? (
            <div style={{ fontSize: 13, color: C.textMuted }}>No faults recorded</div>
          ) : (
            bikeFaults.slice().reverse().map((f) => (
              <div key={f.id} style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}11`, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600 }}>{f.code} — {f.category}</span>
                  <span style={s.badge(f.status === "Open" ? C.red : f.status === "Resolved" || f.status === "Closed" ? C.green : C.yellow)}>{f.status}</span>
                </div>
                <div style={{ color: C.textMuted, marginTop: 2 }}>{fmtDateTime(f.date)} • {f.severity} • {f.description}</div>
              </div>
            ))
          )}
        </div>

        {/* Check history */}
        <div style={s.card}>
          <h2 style={s.h2}>Check History ({bikeChecks.length})</h2>
          {bikeChecks.length === 0 ? (
            <div style={{ fontSize: 13, color: C.textMuted }}>No checks recorded</div>
          ) : (
            bikeChecks.slice(-10).reverse().map((c) => (
              <div key={c.id} style={{ padding: "6px 0", borderBottom: `1px solid ${C.border}11`, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
                <span>{c.type === "pre-ride" ? "Pre-Ride" : "Post-Ride"} — {c.staff}</span>
                <span><span style={s.badge(c.result === "Passed" || c.result === "Ready" ? C.green : c.result === "Failed" || c.result === "Out of Service" ? C.red : C.yellow)}>{c.result}</span> {fmtDateTime(c.date)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={s.h1}>Fleet ({bikes.length})</h1>
        <button style={s.btn("primary")} onClick={() => setModal("addBike")}><Icon d={Icons.plus} size={16} /> Add Bike</button>
      </div>
      <div style={{ position: "relative", marginBottom: 16 }}>
        <Icon d={Icons.search} size={16} color={C.textMuted} />
        <input style={{ ...s.input, paddingLeft: 36 }} placeholder="Search bikes..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
      </div>
      {filtered.length === 0 ? (
        <div style={{ ...s.card, textAlign: "center", color: C.textMuted }}>
          {bikes.length === 0 ? "No bikes yet. Add your first bike to get started." : "No bikes match your search."}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={s.table}>
            <thead>
              <tr>
                {["", "Bike #", "Name", "Category", "Odometer", "Status", "Last Check", "Faults"].map((h) => <th key={h} style={s.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, idx) => (
                <tr key={b.id}
                  draggable
                  onDragStart={onDragStart(idx)}
                  onDragOver={onDragOver(idx)}
                  onDrop={onDrop(idx)}
                  onDragEnd={onDragEnd}
                  style={{ cursor: "pointer", background: overIdx === idx ? C.accentGlow : "transparent", opacity: dragIdx === idx ? 0.4 : 1 }}
                  onClick={() => setSelectedBike(b.id)}>
                  <td style={{ ...s.td, width: 30 }}><DragHandle /></td>
                  <td style={{ ...s.td, fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.accent }}>{b.bikeNumber || "—"}</td>
                  <td style={{ ...s.td, fontWeight: 600 }}>{b.name || "—"}</td>
                  <td style={{ ...s.td, color: C.textMuted }}>{b.category || "—"}</td>
                  <td style={{ ...s.td, fontFamily: MONO, fontSize: 13 }}>{b.odometer ? `${b.odometer.toLocaleString()} km` : "—"}</td>
                  <td style={s.td}><StatusBadge status={b.status} /></td>
                  <td style={{ ...s.td, fontSize: 12, color: C.textMuted }}>{fmtDateTime(b.lastPreRide || b.lastPostRide)}</td>
                  <td style={s.td}>
                    {faults.filter((f) => f.bikeId === b.id && (f.status === "Open" || f.status === "In Progress")).length > 0 && (
                      <span style={s.badge(C.red)}>
                        {faults.filter((f) => f.bikeId === b.id && (f.status === "Open" || f.status === "In Progress")).length}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// CHECKS PAGE
// ═══════════════════════════════════════════════
function ChecksPage({ checks, bikes, setModal }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={s.h1}>Checks ({checks.length})</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={s.btn("primary")} onClick={() => setModal("preRide")}>Pre-Ride</button>
          <button style={s.btn("secondary")} onClick={() => setModal("postRide")}>Post-Ride</button>
        </div>
      </div>
      {checks.length === 0 ? (
        <div style={{ ...s.card, textAlign: "center", color: C.textMuted }}>No checks completed yet.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={s.table}>
            <thead><tr>{["Date", "Bike", "Type", "Staff", "Result"].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {checks.slice().reverse().map((c) => (
                <tr key={c.id}>
                  <td style={{ ...s.td, fontSize: 12 }}>{fmtDateTime(c.date)}</td>
                  <td style={s.td}>{bikes.find((b) => b.id === c.bikeId)?.name || c.bikeId}</td>
                  <td style={s.td}>{c.type === "pre-ride" ? "Pre-Ride" : "Post-Ride"}</td>
                  <td style={s.td}>{c.staff}</td>
                  <td style={s.td}><span style={s.badge(c.result === "Passed" || c.result === "Ready" ? C.green : c.result === "Failed" || c.result === "Out of Service" ? C.red : C.yellow)}>{c.result}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// FAULTS PAGE
// ═══════════════════════════════════════════════
function FaultsPage({ faults, bikes, staff, setModal, resolveFault, update }) {
  const [filter, setFilter] = useState("open");
  const [editingFault, setEditingFault] = useState(null);
  const filtered = faults.filter((f) => {
    if (filter === "open") return f.status === "Open" || f.status === "In Progress" || f.status === "Waiting Parts";
    if (filter === "resolved") return f.status === "Resolved" || f.status === "Closed";
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={s.h1}>Faults ({faults.length})</h1>
        <button style={s.btn("primary")} onClick={() => setModal("reportFault")}><Icon d={Icons.plus} size={16} /> Report Fault</button>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {[["open", "Open"], ["resolved", "Resolved"], ["all", "All"]].map(([k, l]) => (
          <button key={k} style={s.navBtn(filter === k)} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div style={{ ...s.card, textAlign: "center", color: C.textMuted }}>No faults in this view.</div>
      ) : (
        filtered.slice().reverse().map((f) => (
          <div key={f.id} style={s.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                  {(() => { const bike = bikes.find((b) => b.id === f.bikeId); return bike ? `#${bike.bikeNumber || "?"} — ${bike.name || "Unnamed"}` : f.bikeId; })()}
                </div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{f.code} — {f.category}</div>
                <div style={{ color: C.textMuted, fontSize: 12, marginTop: 2 }}>
                  {fmtDateTime(f.date)} • {f.reportedBy}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={s.badge(f.severity === "Critical" ? C.red : f.severity === "Service Required" ? C.yellow : C.blue)}>{f.severity}</span>
                <span style={s.badge(f.status === "Open" ? C.red : f.status === "Resolved" || f.status === "Closed" ? C.green : C.yellow)}>{f.status}</span>
              </div>
            </div>
            {f.description && <div style={{ marginTop: 8, fontSize: 13 }}>{f.description}</div>}
            {f.resolution && <div style={{ marginTop: 6, fontSize: 12, color: C.green }}>✓ {f.resolution}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button style={{ ...s.btn("ghost"), fontSize: 12 }} onClick={() => setEditingFault(f.id)}>✎ Edit</button>
              {(f.status === "Open" || f.status === "In Progress") && (
                <button style={{ ...s.btn("ghost"), fontSize: 12 }} onClick={() => {
                  const notes = prompt("Resolution notes:");
                  if (notes) resolveFault(f.id, notes, "");
                }}>Resolve</button>
              )}
            </div>
          </div>
        ))
      )}

      {editingFault && <EditFaultModal
        fault={faults.find((f) => f.id === editingFault)}
        bikes={bikes}
        staff={staff}
        onSave={(data) => {
          update("faults", (prev) => prev.map((f) => f.id === editingFault ? { ...f, ...data } : f));
          // Update bike status based on severity
          if (data.severity === "Critical") {
            update("bikes", (prev) => prev.map((b) => b.id === data.bikeId ? { ...b, status: "Out of Service" } : b));
          } else if (data.severity === "Service Required") {
            update("bikes", (prev) => prev.map((b) => b.id === data.bikeId ? { ...b, status: "Service Due" } : b));
          }
          setEditingFault(null);
        }}
        onDelete={() => {
          if (confirm("Delete this fault permanently?")) {
            update("faults", (prev) => prev.filter((f) => f.id !== editingFault));
            setEditingFault(null);
          }
        }}
        onClose={() => setEditingFault(null)}
      />}
    </div>
  );
}

function EditFaultModal({ fault, bikes, staff, onSave, onDelete, onClose }) {
  const [f, setF] = useState({
    bikeId: fault.bikeId || "",
    reportedBy: fault.reportedBy || "",
    category: fault.category || "",
    code: fault.code || "",
    severity: fault.severity || "Service Required",
    description: fault.description || "",
    status: fault.status || "Open",
    assignedTo: fault.assignedTo || "",
    resolution: fault.resolution || "",
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const codes = f.category ? (FAULT_CODES[f.category] || []) : [];

  return (
    <ModalShell title="Edit Fault" onClose={onClose}>
      <Field label="Bike">
        <Select value={f.bikeId} onChange={(v) => set("bikeId", v)} options={bikes.map((b) => [b.id, `${b.bikeNumber ? "#" + b.bikeNumber + " — " : ""}${b.name || b.id}`])} placeholder="Select bike..." />
      </Field>
      <Field label="Reported By">
        <input style={s.input} value={f.reportedBy} onChange={(e) => set("reportedBy", e.target.value)} />
      </Field>
      <Field label="Category">
        <Select value={f.category} onChange={(v) => { set("category", v); set("code", ""); }} options={FAULT_CATEGORIES} placeholder="Select..." />
      </Field>
      {codes.length > 0 && (
        <Field label="Fault Code">
          <Select value={f.code} onChange={(v) => set("code", v)} options={codes} placeholder="Select code..." />
        </Field>
      )}
      <Field label="Severity">
        <Select value={f.severity} onChange={(v) => set("severity", v)} options={FAULT_SEVERITY} />
      </Field>
      <Field label="Status">
        <Select value={f.status} onChange={(v) => set("status", v)} options={FAULT_STATUS} />
      </Field>
      <Field label="Assigned To">
        <input style={s.input} value={f.assignedTo} onChange={(e) => set("assignedTo", e.target.value)} placeholder="Staff name" />
      </Field>
      <Field label="Description">
        <textarea style={{ ...s.input, minHeight: 50 }} value={f.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <Field label="Resolution Notes">
        <textarea style={{ ...s.input, minHeight: 50 }} value={f.resolution} onChange={(e) => set("resolution", e.target.value)} />
      </Field>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={s.btn("primary")} onClick={() => onSave(f)}>
          <Icon d={Icons.save} size={16} /> Save Changes
        </button>
        <button style={s.btn("danger")} onClick={onDelete}>Delete</button>
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════
// SERVICES PAGE
// ═══════════════════════════════════════════════
function ServicesPage({ services, bikes, parts, setModal, update }) {
  const [selectedService, setSelectedService] = useState(null);
  const [filter, setFilter] = useState("pending");

  const service = selectedService ? services.find((sv) => sv.id === selectedService) : null;

  if (service) {
    return <ServiceWorkspace service={service} bikes={bikes} parts={parts} update={update} onBack={() => setSelectedService(null)} />;
  }

  const filtered = services.filter((sv) => {
    if (filter === "pending") return !sv.completedDate;
    if (filter === "complete") return !!sv.completedDate;
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={s.h1}>Services ({services.length})</h1>
        <button style={s.btn("primary")} onClick={() => setModal("addService")}><Icon d={Icons.plus} size={16} /> New Service</button>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {[["pending", "Pending"], ["complete", "Complete"], ["all", "All"]].map(([k, l]) => (
          <button key={k} style={s.navBtn(filter === k)} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div style={{ ...s.card, textAlign: "center", color: C.textMuted }}>No service records in this view.</div>
      ) : (
        filtered.slice().reverse().map((sv) => {
          const partsCount = (sv.partsUsed || []).reduce((sum, p) => sum + (p.qty || 0), 0);
          return (
            <div key={sv.id} style={{ ...s.card, cursor: "pointer" }}
              onClick={() => setSelectedService(sv.id)}
              onMouseOver={(e) => e.currentTarget.style.borderColor = C.accent + "55"}
              onMouseOut={(e) => e.currentTarget.style.borderColor = C.border}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{sv.serviceType} — {bikes.find((b) => b.id === sv.bikeId)?.name || sv.bikeId}</div>
                  <div style={{ color: C.textMuted, fontSize: 12, marginTop: 2 }}>
                    {sv.assignedTo || "Unassigned"} • Due: {fmtDate(sv.dueDate)} {sv.completedDate ? `• Done: ${fmtDate(sv.completedDate)}` : ""}
                    {partsCount > 0 && ` • ${partsCount} part${partsCount > 1 ? "s" : ""} used`}
                  </div>
                </div>
                <span style={s.badge(sv.completedDate ? C.green : C.yellow)}>{sv.completedDate ? "Complete" : "Pending"}</span>
              </div>
              {sv.tasks && <div style={{ marginTop: 6, fontSize: 13, color: C.textMuted }}>{sv.tasks}</div>}
            </div>
          );
        })
      )}
    </div>
  );
}

function ServiceWorkspace({ service, bikes, parts, update, onBack }) {
  const bike = bikes.find((b) => b.id === service.bikeId);
  const [notes, setNotes] = useState(service.workNotes || "");
  const [partsUsed, setPartsUsed] = useState(service.partsUsed || []);
  const [addingPart, setAddingPart] = useState(false);
  const [timeSpent, setTimeSpent] = useState(service.timeSpent || "");

  // Save handler for draft updates (doesn't complete)
  const saveDraft = () => {
    update("services", (prev) => prev.map((sv) => sv.id === service.id ? { ...sv, workNotes: notes, partsUsed, timeSpent } : sv));
  };

  const addPart = (partId, qty) => {
    const part = parts.find((p) => p.id === partId);
    if (!part) return;
    const existing = partsUsed.find((pu) => pu.partId === partId);
    let next;
    if (existing) {
      next = partsUsed.map((pu) => pu.partId === partId ? { ...pu, qty: pu.qty + qty } : pu);
    } else {
      next = [...partsUsed, { partId, name: part.name, qty, cost: part.cost || 0 }];
    }
    setPartsUsed(next);
    setAddingPart(false);
  };

  const removePart = (partId) => {
    setPartsUsed(partsUsed.filter((pu) => pu.partId !== partId));
  };

  const updatePartQty = (partId, qty) => {
    if (qty <= 0) return removePart(partId);
    setPartsUsed(partsUsed.map((pu) => pu.partId === partId ? { ...pu, qty } : pu));
  };

  const completeService = () => {
    // Check stock first
    const shortages = [];
    partsUsed.forEach((pu) => {
      const part = parts.find((p) => p.id === pu.partId);
      if (!part || part.qty < pu.qty) {
        shortages.push(`${pu.name}: need ${pu.qty}, have ${part?.qty || 0}`);
      }
    });
    if (shortages.length > 0) {
      if (!confirm(`Warning — insufficient stock for:\n${shortages.join("\n")}\n\nComplete anyway? (Stock will go to zero for shortages)`)) return;
    }

    // Deduct parts from inventory
    update("parts", (prev) => prev.map((p) => {
      const used = partsUsed.find((pu) => pu.partId === p.id);
      if (!used) return p;
      return { ...p, qty: Math.max(0, p.qty - used.qty) };
    }));

    // Mark service complete
    update("services", (prev) => prev.map((sv) => sv.id === service.id ? {
      ...sv, completedDate: now(), workNotes: notes, partsUsed, timeSpent, outcome: "Completed",
    } : sv));

    // Update bike
    update("bikes", (prev) => prev.map((b) => b.id === service.bikeId ? { ...b, status: "Ready", lastService: now() } : b));

    onBack();
  };

  const totalCost = partsUsed.reduce((sum, pu) => sum + (pu.cost || 0) * pu.qty, 0);
  const isComplete = !!service.completedDate;

  return (
    <div>
      <button style={s.btn("ghost")} onClick={onBack}>
        <Icon d={Icons.back} size={16} /> Back to Services
      </button>
      <div style={{ ...s.card, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <h1 style={{ ...s.h1, marginBottom: 4 }}>{service.serviceType}</h1>
            <div style={{ fontSize: 13, color: C.textMuted }}>
              {bike?.name || service.bikeId} • {bike?.category}
            </div>
          </div>
          <span style={s.badge(isComplete ? C.green : C.yellow)}>{isComplete ? "Complete" : "In Progress"}</span>
        </div>
        <div style={{ ...s.grid(2), marginTop: 8 }}>
          <div><span style={s.label}>Assigned To</span><div style={{ fontSize: 13 }}>{service.assignedTo || "—"}</div></div>
          <div><span style={s.label}>Due Date</span><div style={{ fontSize: 13 }}>{fmtDate(service.dueDate)}</div></div>
          {isComplete && <div><span style={s.label}>Completed</span><div style={{ fontSize: 13 }}>{fmtDate(service.completedDate)}</div></div>}
          {service.tasks && <div style={{ gridColumn: "1 / -1" }}><span style={s.label}>Scheduled Tasks</span><div style={{ fontSize: 13 }}>{service.tasks}</div></div>}
        </div>
      </div>

      {/* Work Notes */}
      <div style={s.card}>
        <h2 style={s.h2}>Work Notes</h2>
        <textarea
          style={{ ...s.input, minHeight: 100 }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What was done on this job? Any findings, issues, observations..."
          disabled={isComplete}
        />
      </div>

      {/* Parts Used */}
      <div style={s.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ ...s.h2, margin: 0 }}>Parts Used ({partsUsed.length})</h2>
          {!isComplete && (
            <button style={s.btn("secondary")} onClick={() => setAddingPart(true)}>
              <Icon d={Icons.plus} size={14} /> Add Part
            </button>
          )}
        </div>
        {partsUsed.length === 0 ? (
          <div style={{ fontSize: 13, color: C.textMuted, padding: "8px 0" }}>No parts added yet</div>
        ) : (
          <div>
            {partsUsed.map((pu) => {
              const stockPart = parts.find((p) => p.id === pu.partId);
              const lowStock = stockPart && stockPart.qty < pu.qty;
              return (
                <div key={pu.partId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.border}22` }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{pu.name}</div>
                    <div style={{ fontSize: 11, color: lowStock ? C.red : C.textMuted, marginTop: 2 }}>
                      Stock on hand: {stockPart?.qty ?? 0} {lowStock && "⚠ insufficient"}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: C.textMuted, marginRight: 6 }}>${((pu.cost || 0) * pu.qty).toFixed(2)}</span>
                    {!isComplete ? (
                      <>
                        <button style={{ ...s.btn("ghost"), padding: "4px 10px", fontSize: 13 }} onClick={() => updatePartQty(pu.partId, pu.qty - 1)}>−</button>
                        <span style={{ fontFamily: MONO, fontWeight: 700, minWidth: 24, textAlign: "center" }}>{pu.qty}</span>
                        <button style={{ ...s.btn("ghost"), padding: "4px 10px", fontSize: 13 }} onClick={() => updatePartQty(pu.partId, pu.qty + 1)}>+</button>
                        <button style={{ ...s.btn("ghost"), padding: "4px 8px", fontSize: 11, color: C.red }} onClick={() => removePart(pu.partId)}>✕</button>
                      </>
                    ) : (
                      <span style={{ fontFamily: MONO, fontWeight: 700 }}>×{pu.qty}</span>
                    )}
                  </div>
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, fontSize: 14, fontWeight: 600 }}>
              <span>Total parts cost</span>
              <span style={{ fontFamily: MONO, color: C.accent }}>${totalCost.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Time Spent */}
      {!isComplete && (
        <div style={s.card}>
          <h2 style={s.h2}>Time Spent</h2>
          <input style={s.input} value={timeSpent} onChange={(e) => setTimeSpent(e.target.value)} placeholder="e.g. 45 min, 1.5 hours" disabled={isComplete} />
        </div>
      )}

      {/* Actions */}
      {!isComplete ? (
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button style={s.btn("primary")} onClick={completeService}>
            <Icon d={Icons.check} size={16} /> Mark Complete & Deduct Parts
          </button>
          <button style={s.btn("secondary")} onClick={() => { saveDraft(); alert("Progress saved"); }}>
            <Icon d={Icons.save} size={16} /> Save Progress
          </button>
        </div>
      ) : (
        <div style={{ ...s.card, background: C.greenBg, borderColor: C.green + "33", marginTop: 12 }}>
          <div style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>✓ Service completed on {fmtDateTime(service.completedDate)}</div>
          {service.timeSpent && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>Time: {service.timeSpent}</div>}
        </div>
      )}

      {/* Add Part Modal */}
      {addingPart && <AddPartToServiceModal parts={parts} onAdd={addPart} onClose={() => setAddingPart(false)} />}
    </div>
  );
}

function AddPartToServiceModal({ parts, onAdd, onClose }) {
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState(1);
  const [search, setSearch] = useState("");

  const filtered = parts.filter((p) => {
    const t = search.toLowerCase();
    return !t || p.name?.toLowerCase().includes(t) || p.category?.toLowerCase().includes(t);
  });

  return (
    <ModalShell title="Add Part from Inventory" onClose={onClose}>
      <Field label="Search">
        <input style={s.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search parts..." />
      </Field>
      <div style={{ maxHeight: 280, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 14 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: C.textMuted, textAlign: "center" }}>No parts match</div>
        ) : filtered.map((p) => (
          <div key={p.id}
            style={{
              padding: "10px 12px",
              borderBottom: `1px solid ${C.border}22`,
              cursor: "pointer",
              background: partId === p.id ? C.accentGlow : "transparent",
              borderLeft: partId === p.id ? `3px solid ${C.accent}` : "3px solid transparent",
            }}
            onClick={() => setPartId(p.id)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{p.category} • ${p.cost || 0}</div>
              </div>
              <span style={s.badge(p.qty <= p.reorder ? C.red : C.green)}>{p.qty} in stock</span>
            </div>
          </div>
        ))}
      </div>
      <Field label="Quantity Used">
        <input style={s.input} type="number" min="1" value={qty} onChange={(e) => setQty(parseInt(e.target.value) || 1)} />
      </Field>
      <button style={s.btn("primary")} onClick={() => {
        if (!partId) return alert("Select a part");
        if (qty < 1) return alert("Quantity must be at least 1");
        onAdd(partId, qty);
      }}>
        <Icon d={Icons.plus} size={16} /> Add to Job
      </button>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════
// BATTERIES PAGE
// ═══════════════════════════════════════════════
function BatteriesPage({ batteries, bikes, setModal, update }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={s.h1}>Batteries ({batteries.length})</h1>
        <button style={s.btn("primary")} onClick={() => setModal("addBattery")}><Icon d={Icons.plus} size={16} /> Add Battery</button>
      </div>
      {batteries.length === 0 ? (
        <div style={{ ...s.card, textAlign: "center", color: C.textMuted }}>No batteries registered yet.</div>
      ) : (
        <div style={s.grid(2)}>
          {batteries.map((bat) => (
            <div key={bat.id} style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontFamily: MONO, fontSize: 13 }}>{bat.id}</span>
                <span style={s.badge(bat.status === "Active" ? C.green : bat.status === "Monitor" ? C.yellow : bat.status === "Retired" ? C.textMuted : C.purple)}>{bat.status}</span>
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 6 }}>
                {bat.serial && <>Serial: {bat.serial}<br /></>}
                Linked: {bikes.find((b) => b.batteryId === bat.id)?.name || "Unassigned"}
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                {BATTERY_STATUSES.map((st) => (
                  <button key={st} style={{ ...s.btn("ghost"), fontSize: 10, padding: "4px 8px", opacity: bat.status === st ? 1 : 0.5 }}
                    onClick={() => update("batteries", (prev) => prev.map((b) => b.id === bat.id ? { ...b, status: st } : b))}>
                    {st}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// PARTS PAGE
// ═══════════════════════════════════════════════
function PartsPage({ parts, update }) {
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");

  const sorted = [...parts].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
  const filtered = sorted.filter((p) => {
    const t = search.toLowerCase();
    return !t || p.name?.toLowerCase().includes(t) || p.category?.toLowerCase().includes(t) || p.supplier?.toLowerCase().includes(t) || p.supplierCode?.toLowerCase().includes(t);
  });
  const { dragIdx, overIdx, onDragStart, onDragOver, onDrop, onDragEnd } = useDragReorder(filtered, "parts", update);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={s.h1}>Parts Inventory ({parts.length})</h1>
        <button style={s.btn("primary")} onClick={() => setEditing("new")}><Icon d={Icons.plus} size={16} /> Add Part</button>
      </div>
      <div style={{ position: "relative", marginBottom: 16 }}>
        <input style={s.input} placeholder="Search by name, category, supplier, or supplier code..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {filtered.length === 0 ? (
        <div style={{ ...s.card, textAlign: "center", color: C.textMuted }}>
          {parts.length === 0 ? "No parts yet. Add your first part to get started." : "No parts match your search."}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={s.table}>
            <thead><tr>{["", "Part", "Category", "Supplier", "Supplier Code", "Qty", "Reorder", "Cost", "Status", ""].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((p, idx) => (
                <tr key={p.id}
                  draggable
                  onDragStart={onDragStart(idx)}
                  onDragOver={onDragOver(idx)}
                  onDrop={onDrop(idx)}
                  onDragEnd={onDragEnd}
                  style={{ background: overIdx === idx ? C.accentGlow : "transparent", opacity: dragIdx === idx ? 0.4 : 1 }}>
                  <td style={{ ...s.td, width: 30 }}><DragHandle /></td>
                  <td style={{ ...s.td, fontWeight: 500 }}>{p.name}</td>
                  <td style={{ ...s.td, color: C.textMuted }}>{p.category || "—"}</td>
                  <td style={{ ...s.td, color: C.textMuted }}>{p.supplier || "—"}</td>
                  <td style={{ ...s.td, fontFamily: MONO, fontSize: 12, color: C.textMuted }}>{p.supplierCode || "—"}</td>
                  <td style={{ ...s.td, fontFamily: MONO, fontWeight: 700, color: p.qty <= p.reorder ? C.red : C.text }}>{p.qty}</td>
                  <td style={{ ...s.td, fontFamily: MONO, color: C.textMuted }}>{p.reorder}</td>
                  <td style={{ ...s.td, fontFamily: MONO, color: C.textMuted }}>${p.cost || 0}</td>
                  <td style={s.td}>
                    {p.qty <= p.reorder ? <span style={s.badge(C.red)}>LOW</span> : <span style={s.badge(C.green)}>OK</span>}
                  </td>
                  <td style={s.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button style={{ ...s.btn("ghost"), padding: "4px 8px", fontSize: 11 }}
                        onClick={() => update("parts", (prev) => prev.map((pp) => pp.id === p.id ? { ...pp, qty: Math.max(0, pp.qty - 1) } : pp))}>−</button>
                      <button style={{ ...s.btn("ghost"), padding: "4px 8px", fontSize: 11 }}
                        onClick={() => update("parts", (prev) => prev.map((pp) => pp.id === p.id ? { ...pp, qty: pp.qty + 1 } : pp))}>+</button>
                      <button style={{ ...s.btn("ghost"), padding: "4px 10px", fontSize: 11 }} onClick={() => setEditing(p.id)}>Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <PartModal
        existing={editing === "new" ? null : parts.find((p) => p.id === editing)}
        onSubmit={(data) => {
          if (editing === "new") {
            update("parts", (prev) => [...prev, { ...data, id: uid("P") }]);
          } else {
            update("parts", (prev) => prev.map((p) => p.id === editing ? { ...p, ...data } : p));
          }
          setEditing(null);
        }}
        onDelete={editing !== "new" ? () => {
          if (confirm("Delete this part?")) {
            update("parts", (prev) => prev.filter((p) => p.id !== editing));
            setEditing(null);
          }
        } : null}
        onClose={() => setEditing(null)}
      />}
    </div>
  );
}

function PartModal({ existing, onSubmit, onDelete, onClose }) {
  const [f, setF] = useState(existing ? { ...existing } : {
    name: "", category: "", supplier: "", supplierCode: "", qty: 0, reorder: 1, cost: 0, compatible: "", notes: "",
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <ModalShell title={existing ? "Edit Part" : "Add Part"} onClose={onClose}>
      <Field label="Part Name"><input style={s.input} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Brake Pads (Set)" /></Field>
      <Field label="Category"><Select value={f.category} onChange={(v) => set("category", v)} options={PART_CATEGORIES} placeholder="Select..." /></Field>
      <div style={s.grid(2)}>
        <Field label="Supplier"><input style={s.input} value={f.supplier} onChange={(e) => set("supplier", e.target.value)} placeholder="e.g. BikeBug" /></Field>
        <Field label="Supplier Product Code"><input style={s.input} value={f.supplierCode} onChange={(e) => set("supplierCode", e.target.value)} placeholder="e.g. BB-1234" /></Field>
      </div>
      <div style={s.grid(3)}>
        <Field label="Qty on Hand"><input style={s.input} type="number" min="0" value={f.qty} onChange={(e) => set("qty", parseInt(e.target.value) || 0)} /></Field>
        <Field label="Reorder At"><input style={s.input} type="number" min="0" value={f.reorder} onChange={(e) => set("reorder", parseInt(e.target.value) || 0)} /></Field>
        <Field label="Cost ($)"><input style={s.input} type="number" min="0" step="0.01" value={f.cost} onChange={(e) => set("cost", parseFloat(e.target.value) || 0)} /></Field>
      </div>
      <Field label="Compatible With"><input style={s.input} value={f.compatible} onChange={(e) => set("compatible", e.target.value)} placeholder="e.g. All, Fat Tyre, Vallkree" /></Field>
      <Field label="Notes"><textarea style={{ ...s.input, minHeight: 60 }} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={s.btn("primary")} onClick={() => {
          if (!f.name) return alert("Part name required");
          onSubmit(f);
        }}><Icon d={Icons.save} size={16} /> {existing ? "Save Changes" : "Add Part"}</button>
        {onDelete && <button style={s.btn("danger")} onClick={onDelete}>Delete</button>}
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════

function ModalShell({ title, children, onClose }) {
  return (
    <div style={s.modal} onClick={onClose}>
      <div style={s.modalContent} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ ...s.h2, margin: 0 }}>{title}</h2>
          <button style={{ ...s.btn("ghost"), padding: 6 }} onClick={onClose}><Icon d={Icons.x} size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AddBikeModal({ onSubmit, onClose, batteries, existing }) {
  const isEdit = !!existing;
  const [f, setF] = useState(existing ? {
    bikeNumber: existing.bikeNumber || "",
    name: existing.name || "",
    category: existing.category || "",
    brand: existing.brand || "",
    model: existing.model || "",
    serial: existing.serial || "",
    purchaseDate: existing.purchaseDate || "",
    batteryId: existing.batteryId || "",
    notes: existing.notes || "",
    status: existing.status || "Ready",
    conditionScore: existing.conditionScore ?? 10,
    totalKm: existing.totalKm || 0,
    totalRides: existing.totalRides || 0,
    odometer: existing.odometer || 0,
  } : { bikeNumber: "", name: "", category: "", brand: "", model: "", serial: "", purchaseDate: "", batteryId: "", notes: "", odometer: 0 });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <ModalShell title={isEdit ? "Edit Bike" : "Add Bike"} onClose={onClose}>
      <div style={s.grid(2)}>
        <Field label="Bike Number"><input style={s.input} value={f.bikeNumber} onChange={(e) => set("bikeNumber", e.target.value)} placeholder="e.g. 01, 02, VK-01" /></Field>
        <Field label="Bike Name"><input style={s.input} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Cruiser #7" /></Field>
      </div>
      <Field label="Category"><Select value={f.category} onChange={(v) => set("category", v)} options={BIKE_CATEGORIES} placeholder="Select..." /></Field>
      <div style={s.grid(2)}>
        <Field label="Brand"><input style={s.input} value={f.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
        <Field label="Model"><input style={s.input} value={f.model} onChange={(e) => set("model", e.target.value)} /></Field>
      </div>
      <div style={s.grid(2)}>
        <Field label="Serial Number"><input style={s.input} value={f.serial} onChange={(e) => set("serial", e.target.value)} /></Field>
        <Field label="Purchase Date"><input style={s.input} type="date" value={f.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} /></Field>
      </div>
      <Field label="Linked Battery">
        <Select value={f.batteryId} onChange={(v) => set("batteryId", v)} options={batteries.map((b) => [b.id, b.serial || b.id])} placeholder="None" />
      </Field>
      <Field label="Odometer (km)"><input style={s.input} type="number" min="0" value={f.odometer} onChange={(e) => set("odometer", parseInt(e.target.value) || 0)} /></Field>
      {isEdit && (
        <>
          <Field label="Status"><Select value={f.status} onChange={(v) => set("status", v)} options={BIKE_STATUSES} /></Field>
          <div style={s.grid(3)}>
            <Field label="Condition (0-10)"><input style={s.input} type="number" min="0" max="10" value={f.conditionScore} onChange={(e) => set("conditionScore", parseInt(e.target.value) || 0)} /></Field>
            <Field label="Total KM"><input style={s.input} type="number" value={f.totalKm} onChange={(e) => set("totalKm", parseInt(e.target.value) || 0)} /></Field>
            <Field label="Total Rides"><input style={s.input} type="number" value={f.totalRides} onChange={(e) => set("totalRides", parseInt(e.target.value) || 0)} /></Field>
          </div>
        </>
      )}
      <Field label="Notes"><textarea style={{ ...s.input, minHeight: 60 }} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      <button style={s.btn("primary")} onClick={() => { if (!f.name) return alert("Name required"); onSubmit(f); }}>
        <Icon d={Icons.save} size={16} /> {isEdit ? "Save Changes" : "Save Bike"}
      </button>
    </ModalShell>
  );
}

function AddBatteryModal({ onSubmit, onClose }) {
  const [f, setF] = useState({ serial: "", purchaseDate: "", notes: "" });
  return (
    <ModalShell title="Add Battery" onClose={onClose}>
      <Field label="Serial Number"><input style={s.input} value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} /></Field>
      <Field label="Purchase Date"><input style={s.input} type="date" value={f.purchaseDate} onChange={(e) => setF({ ...f, purchaseDate: e.target.value })} /></Field>
      <Field label="Notes"><textarea style={{ ...s.input, minHeight: 60 }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <button style={s.btn("primary")} onClick={() => onSubmit(f)}><Icon d={Icons.save} size={16} /> Save Battery</button>
    </ModalShell>
  );
}

function CheckModal({ type, bikes, staff, onSubmit, onClose, preselect }) {
  const isPre = type === "pre-ride";
  const items = isPre ? CHECK_ITEMS_PRE : CHECK_ITEMS_POST;
  const results = isPre ? PRE_RESULTS : POST_RESULTS;
  const [bikeId, setBikeId] = useState(preselect || "");
  const [staffName, setStaffName] = useState(staff[0]?.name || "");
  const [toggles, setToggles] = useState(Object.fromEntries(items.map((i) => [i, true])));
  const [result, setResult] = useState(results[0]);
  const [notes, setNotes] = useState("");
  const [odometer, setOdometer] = useState("");

  // Auto-fill odometer from selected bike
  const selectedBike = bikes.find((b) => b.id === bikeId);
  useEffect(() => {
    if (selectedBike && isPre) {
      setOdometer(selectedBike.odometer || "");
    }
  }, [bikeId]);

  return (
    <ModalShell title={isPre ? "Pre-Ride Check" : "Post-Ride Check"} onClose={onClose}>
      <Field label="Bike">
        <Select value={bikeId} onChange={setBikeId} options={bikes.map((b) => [b.id, `${b.bikeNumber ? "#" + b.bikeNumber + " — " : ""}${b.name || b.id}`])} placeholder="Select bike..." />
      </Field>
      <Field label="Staff">
        <input style={s.input} value={staffName} onChange={(e) => setStaffName(e.target.value)} />
      </Field>
      {isPre && (
        <Field label="Odometer (km)">
          <input style={{ ...s.input, fontFamily: MONO, fontSize: 16, fontWeight: 700 }} type="number" min="0" value={odometer} onChange={(e) => setOdometer(parseInt(e.target.value) || 0)} placeholder="Current reading" />
        </Field>
      )}
      <div style={{ ...s.card, padding: 14, margin: "12px 0" }}>
        {items.map((item) => (
          <Toggle key={item} label={CHECK_LABELS[item] || item.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())} value={toggles[item]}
            onChange={(v) => setToggles((p) => ({ ...p, [item]: v }))} />
        ))}
      </div>
      <Field label="Result">
        <Select value={result} onChange={setResult} options={results} />
      </Field>
      <Field label="Notes"><textarea style={{ ...s.input, minHeight: 60 }} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <button style={s.btn(result === "Failed" || result === "Out of Service" ? "danger" : "primary")} onClick={() => {
        if (!bikeId) return alert("Select a bike");
        onSubmit({ bikeId, staff: staffName, type, toggles, result, notes, odometer: isPre ? odometer : undefined });
      }}>
        <Icon d={Icons.check} size={16} /> Submit {isPre ? "Pre" : "Post"}-Ride
      </button>
    </ModalShell>
  );
}

function FaultModal({ bikes, staff, onSubmit, onClose, preselect }) {
  const [bikeId, setBikeId] = useState(preselect || "");
  const [reporter, setReporter] = useState(staff[0]?.name || "");
  const [category, setCategory] = useState("");
  const [code, setCode] = useState("");
  const [severity, setSeverity] = useState("Service Required");
  const [description, setDescription] = useState("");

  const codes = category ? (FAULT_CODES[category] || []) : [];

  return (
    <ModalShell title="Report Fault" onClose={onClose}>
      <Field label="Bike">
        <Select value={bikeId} onChange={setBikeId} options={bikes.map((b) => [b.id, b.name || b.id])} placeholder="Select bike..." />
      </Field>
      <Field label="Reported By">
        <input style={s.input} value={reporter} onChange={(e) => setReporter(e.target.value)} />
      </Field>
      <Field label="Category">
        <Select value={category} onChange={(v) => { setCategory(v); setCode(""); }} options={FAULT_CATEGORIES} placeholder="Select..." />
      </Field>
      {codes.length > 0 && (
        <Field label="Fault Code">
          <Select value={code} onChange={setCode} options={codes} placeholder="Select code..." />
        </Field>
      )}
      <Field label="Severity">
        <Select value={severity} onChange={setSeverity} options={FAULT_SEVERITY} />
      </Field>
      <Field label="Description (short)">
        <textarea style={{ ...s.input, minHeight: 50 }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's wrong?" />
      </Field>
      <button style={s.btn("danger")} onClick={() => {
        if (!bikeId || !category) return alert("Select bike and category");
        onSubmit({ bikeId, reportedBy: reporter, category, code: code || "—", severity, description });
      }}>
        <Icon d={Icons.fault} size={16} /> Submit Fault
      </button>
    </ModalShell>
  );
}

function ServiceModal({ bikes, staff, onSubmit, onClose }) {
  const [f, setF] = useState({ bikeId: "", serviceType: "", dueDate: "", assignedTo: staff[0]?.name || "", tasks: "" });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <ModalShell title="Schedule Service" onClose={onClose}>
      <Field label="Bike"><Select value={f.bikeId} onChange={(v) => set("bikeId", v)} options={bikes.map((b) => [b.id, b.name || b.id])} placeholder="Select..." /></Field>
      <Field label="Service Type"><Select value={f.serviceType} onChange={(v) => set("serviceType", v)} options={SERVICE_TYPES} placeholder="Select..." /></Field>
      <Field label="Due Date"><input style={s.input} type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></Field>
      <Field label="Assigned To"><input style={s.input} value={f.assignedTo} onChange={(e) => set("assignedTo", e.target.value)} /></Field>
      <Field label="Tasks"><textarea style={{ ...s.input, minHeight: 60 }} value={f.tasks} onChange={(e) => set("tasks", e.target.value)} /></Field>
      <button style={s.btn("primary")} onClick={() => {
        if (!f.bikeId || !f.serviceType) return alert("Select bike and service type");
        onSubmit(f);
      }}><Icon d={Icons.save} size={16} /> Schedule</button>
    </ModalShell>
  );
}

function ConfirmModal({ title, message, onConfirm, onClose }) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 20, lineHeight: 1.5 }}>{message}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={s.btn("danger")} onClick={onConfirm}>Yes, delete</button>
        <button style={s.btn("ghost")} onClick={onClose}>Cancel</button>
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════
// REPORTS PAGE
// ═══════════════════════════════════════════════
function ReportsPage({ bikes, checks, faults, services, batteries, parts }) {
  const [period, setPeriod] = useState("week"); // day, week, month, custom
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [reportType, setReportType] = useState("operational"); // operational, financial, fleet-health

  // Compute date range
  const { startDate, endDate, label } = useMemo(() => {
    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    let start = new Date(now);
    let lbl = "";
    if (period === "day") {
      start.setHours(0, 0, 0, 0);
      lbl = "Today — " + start.toLocaleDateString("en-AU", { weekday: "long", day: "2-digit", month: "short" });
    } else if (period === "week") {
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      lbl = `Last 7 days — ${start.toLocaleDateString("en-AU", { day: "2-digit", month: "short" })} to ${end.toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}`;
    } else if (period === "month") {
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      lbl = `Last 30 days — ${start.toLocaleDateString("en-AU", { day: "2-digit", month: "short" })} to ${end.toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}`;
    } else if (period === "custom" && customStart && customEnd) {
      start = new Date(customStart);
      start.setHours(0, 0, 0, 0);
      const e = new Date(customEnd);
      e.setHours(23, 59, 59, 999);
      lbl = `${start.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })} to ${e.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })}`;
      return { startDate: start, endDate: e, label: lbl };
    }
    return { startDate: start, endDate: end, label: lbl };
  }, [period, customStart, customEnd]);

  const inRange = (iso) => {
    if (!iso) return false;
    const d = new Date(iso).getTime();
    return d >= startDate.getTime() && d <= endDate.getTime();
  };

  // Filter data within period
  const periodChecks = useMemo(() => checks.filter((c) => inRange(c.date)), [checks, startDate, endDate]);
  const periodFaults = useMemo(() => faults.filter((f) => inRange(f.date)), [faults, startDate, endDate]);
  const periodServices = useMemo(() => services.filter((sv) => inRange(sv.completedDate || sv.created)), [services, startDate, endDate]);

  // ─── OPERATIONAL METRICS ───
  const opMetrics = useMemo(() => {
    const checksPassed = periodChecks.filter((c) => c.result === "Passed" || c.result === "Ready").length;
    const checksFailed = periodChecks.filter((c) => c.result === "Failed" || c.result === "Out of Service").length;
    const faultsByCategory = {};
    periodFaults.forEach((f) => { faultsByCategory[f.category] = (faultsByCategory[f.category] || 0) + 1; });
    const faultsBySeverity = { Monitor: 0, "Service Required": 0, Critical: 0 };
    periodFaults.forEach((f) => { if (faultsBySeverity[f.severity] !== undefined) faultsBySeverity[f.severity]++; });
    const openFaults = periodFaults.filter((f) => f.status === "Open" || f.status === "In Progress").length;
    const resolvedFaults = periodFaults.filter((f) => f.status === "Resolved" || f.status === "Closed").length;

    // Downtime — count bikes currently OOS
    const currentOOS = bikes.filter((b) => b.status === "Out of Service").length;

    return {
      totalChecks: periodChecks.length, checksPassed, checksFailed,
      totalFaults: periodFaults.length, faultsByCategory, faultsBySeverity,
      openFaults, resolvedFaults, currentOOS,
      servicesCompleted: periodServices.filter((sv) => sv.completedDate && inRange(sv.completedDate)).length,
    };
  }, [periodChecks, periodFaults, periodServices, bikes, startDate, endDate]);

  // ─── FINANCIAL METRICS ───
  const finMetrics = useMemo(() => {
    let totalPartsCost = 0;
    const partsUsageMap = {};
    periodServices.forEach((sv) => {
      if (!sv.completedDate || !inRange(sv.completedDate)) return;
      (sv.partsUsed || []).forEach((pu) => {
        totalPartsCost += (pu.cost || 0) * pu.qty;
        if (!partsUsageMap[pu.partId]) partsUsageMap[pu.partId] = { name: pu.name, qty: 0, cost: 0 };
        partsUsageMap[pu.partId].qty += pu.qty;
        partsUsageMap[pu.partId].cost += (pu.cost || 0) * pu.qty;
      });
    });
    const topParts = Object.values(partsUsageMap).sort((a, b) => b.cost - a.cost);
    const inventoryValue = parts.reduce((sum, p) => sum + (p.cost || 0) * (p.qty || 0), 0);
    const lowStockValue = parts.filter((p) => p.qty <= p.reorder).reduce((sum, p) => sum + (p.cost || 0) * Math.max(0, (p.reorder - p.qty + p.reorder)), 0);
    return { totalPartsCost, topParts, inventoryValue, lowStockValue };
  }, [periodServices, parts, startDate, endDate]);

  // ─── FLEET HEALTH METRICS ───
  const healthMetrics = useMemo(() => {
    // Faults per bike
    const faultsByBike = {};
    periodFaults.forEach((f) => {
      if (!faultsByBike[f.bikeId]) faultsByBike[f.bikeId] = 0;
      faultsByBike[f.bikeId]++;
    });
    const problemBikes = Object.entries(faultsByBike)
      .map(([id, count]) => {
        const bike = bikes.find((b) => b.id === id);
        return { id, name: bike?.name || id, category: bike?.category || "—", count };
      })
      .sort((a, b) => b.count - a.count);

    const recurring = problemBikes.filter((b) => b.count >= 3);

    // By category
    const categoryStats = {};
    bikes.forEach((b) => {
      if (!categoryStats[b.category]) categoryStats[b.category] = { total: 0, faults: 0 };
      categoryStats[b.category].total++;
    });
    periodFaults.forEach((f) => {
      const bike = bikes.find((b) => b.id === f.bikeId);
      if (bike && categoryStats[bike.category]) categoryStats[bike.category].faults++;
    });

    // Battery issues
    const batteryFaults = periodFaults.filter((f) => f.category === "Battery").length;
    const problemBatteries = batteries.filter((b) => b.status !== "Active").length;

    return { problemBikes, recurring, categoryStats, batteryFaults, problemBatteries };
  }, [periodFaults, bikes, batteries]);

  // ─── CSV EXPORT ───
  const downloadCSV = (filename, rows) => {
    const csv = rows.map((r) => r.map((cell) => {
      const v = cell === null || cell === undefined ? "" : String(cell);
      return v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportOperational = () => {
    const rows = [
      ["Valley E-Bikes — Operational Report"],
      ["Period", label],
      ["Generated", new Date().toLocaleString("en-AU")],
      [],
      ["Summary"],
      ["Total checks", opMetrics.totalChecks],
      ["Passed", opMetrics.checksPassed],
      ["Failed", opMetrics.checksFailed],
      ["Total faults logged", opMetrics.totalFaults],
      ["Open faults", opMetrics.openFaults],
      ["Resolved faults", opMetrics.resolvedFaults],
      ["Services completed", opMetrics.servicesCompleted],
      ["Currently out of service", opMetrics.currentOOS],
      [],
      ["Faults by category"],
      ["Category", "Count"],
      ...Object.entries(opMetrics.faultsByCategory).sort((a,b) => b[1]-a[1]),
      [],
      ["Faults by severity"],
      ["Severity", "Count"],
      ...Object.entries(opMetrics.faultsBySeverity),
      [],
      ["All faults in period"],
      ["Date", "Bike", "Category", "Code", "Severity", "Status", "Reported By", "Description"],
      ...periodFaults.map((f) => {
        const bike = bikes.find((b) => b.id === f.bikeId);
        return [fmtDateTime(f.date), bike?.name || f.bikeId, f.category, f.code, f.severity, f.status, f.reportedBy, f.description];
      }),
    ];
    downloadCSV(`valley-ebikes-operational-${new Date().toISOString().slice(0,10)}.csv`, rows);
  };

  const exportFinancial = () => {
    const rows = [
      ["Valley E-Bikes — Financial Report"],
      ["Period", label],
      ["Generated", new Date().toLocaleString("en-AU")],
      [],
      ["Summary"],
      ["Total parts cost (period)", `$${finMetrics.totalPartsCost.toFixed(2)}`],
      ["Current inventory value", `$${finMetrics.inventoryValue.toFixed(2)}`],
      [],
      ["Top parts used"],
      ["Part", "Qty Used", "Total Cost"],
      ...finMetrics.topParts.map((p) => [p.name, p.qty, `$${p.cost.toFixed(2)}`]),
      [],
      ["Service jobs with costs"],
      ["Date", "Bike", "Type", "Parts Cost", "Time Spent", "Notes"],
      ...periodServices.filter((sv) => sv.completedDate).map((sv) => {
        const bike = bikes.find((b) => b.id === sv.bikeId);
        const cost = (sv.partsUsed || []).reduce((s, pu) => s + (pu.cost || 0) * pu.qty, 0);
        return [fmtDate(sv.completedDate), bike?.name || sv.bikeId, sv.serviceType, `$${cost.toFixed(2)}`, sv.timeSpent || "", sv.workNotes || ""];
      }),
      [],
      ["Current stock"],
      ["Part", "Category", "Supplier", "Supplier Code", "Qty", "Reorder At", "Cost", "Value"],
      ...parts.map((p) => [p.name, p.category, p.supplier, p.supplierCode, p.qty, p.reorder, `$${(p.cost || 0).toFixed(2)}`, `$${((p.cost || 0) * p.qty).toFixed(2)}`]),
    ];
    downloadCSV(`valley-ebikes-financial-${new Date().toISOString().slice(0,10)}.csv`, rows);
  };

  const exportFleetHealth = () => {
    const rows = [
      ["Valley E-Bikes — Fleet Health Report"],
      ["Period", label],
      ["Generated", new Date().toLocaleString("en-AU")],
      [],
      ["Summary"],
      ["Total fleet", bikes.length],
      ["Ready", bikes.filter((b) => b.status === "Ready").length],
      ["Out of Service", bikes.filter((b) => b.status === "Out of Service").length],
      ["Service Due", bikes.filter((b) => b.status === "Service Due").length],
      ["Battery-related faults (period)", healthMetrics.batteryFaults],
      ["Problem batteries", healthMetrics.problemBatteries],
      ["Recurring problem bikes (3+ faults)", healthMetrics.recurring.length],
      [],
      ["Problem bikes (ranked by fault count)"],
      ["Bike ID", "Name", "Category", "Faults in period"],
      ...healthMetrics.problemBikes.map((b) => [b.id, b.name, b.category, b.count]),
      [],
      ["By category"],
      ["Category", "Bikes", "Faults", "Faults per bike"],
      ...Object.entries(healthMetrics.categoryStats).map(([cat, s]) => [cat, s.total, s.faults, s.total > 0 ? (s.faults / s.total).toFixed(2) : "0"]),
      [],
      ["All bikes current status"],
      ["ID", "Name", "Category", "Status", "Condition", "Total Rides", "Last Service"],
      ...bikes.map((b) => [b.id, b.name, b.category, b.status, b.conditionScore, b.totalRides, b.lastService ? fmtDate(b.lastService) : ""]),
    ];
    downloadCSV(`valley-ebikes-fleet-health-${new Date().toISOString().slice(0,10)}.csv`, rows);
  };

  const exportAll = () => { exportOperational(); setTimeout(exportFinancial, 300); setTimeout(exportFleetHealth, 600); };

  // ─── UI HELPERS ───
  const BarRow = ({ label, value, max, color = C.accent }) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 12 }}>
        <span>{label}</span>
        <span style={{ fontFamily: MONO, fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ background: C.bg, height: 6, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ background: color, height: "100%", width: max > 0 ? `${(value / max) * 100}%` : "0%", transition: "width .3s" }} />
      </div>
    </div>
  );

  const maxCategory = Math.max(1, ...Object.values(opMetrics.faultsByCategory));
  const maxProblemBike = Math.max(1, ...healthMetrics.problemBikes.map((b) => b.count));

  return (
    <div>
      <h1 style={s.h1}>Reports</h1>

      {/* Period selector */}
      <div style={{ ...s.card, padding: 16 }}>
        <div style={{ ...s.label, marginBottom: 10 }}>Report Period</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: period === "custom" ? 12 : 0 }}>
          {[["day", "Today"], ["week", "Last 7 days"], ["month", "Last 30 days"], ["custom", "Custom range"]].map(([k, l]) => (
            <button key={k} style={s.navBtn(period === k)} onClick={() => setPeriod(k)}>{l}</button>
          ))}
        </div>
        {period === "custom" && (
          <div style={s.grid(2)}>
            <Field label="Start Date"><input style={s.input} type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} /></Field>
            <Field label="End Date"><input style={s.input} type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} /></Field>
          </div>
        )}
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 10 }}>{label || "Select dates"}</div>
      </div>

      {/* Report type tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {[["operational", "Operational"], ["financial", "Financial"], ["fleet-health", "Fleet Health"]].map(([k, l]) => (
          <button key={k} style={s.navBtn(reportType === k)} onClick={() => setReportType(k)}>{l}</button>
        ))}
      </div>

      {/* Export actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button style={s.btn("primary")} onClick={
          reportType === "operational" ? exportOperational :
          reportType === "financial" ? exportFinancial : exportFleetHealth
        }><Icon d={Icons.download} size={16} /> Export This Report (CSV)</button>
        <button style={s.btn("ghost")} onClick={exportAll}><Icon d={Icons.download} size={16} /> Export All 3</button>
      </div>

      {/* OPERATIONAL */}
      {reportType === "operational" && (
        <>
          <div style={{ ...s.grid(4), marginBottom: 16 }}>
            <div style={s.statCard(C.green, C.greenBg)}>
              <span style={s.statNum(C.green)}>{opMetrics.checksPassed}</span>
              <span style={s.statLabel}>Checks Passed</span>
            </div>
            <div style={s.statCard(C.red, C.redBg)}>
              <span style={s.statNum(C.red)}>{opMetrics.checksFailed}</span>
              <span style={s.statLabel}>Checks Failed</span>
            </div>
            <div style={s.statCard(C.yellow, C.yellowBg)}>
              <span style={s.statNum(C.yellow)}>{opMetrics.totalFaults}</span>
              <span style={s.statLabel}>Faults Logged</span>
            </div>
            <div style={s.statCard(C.blue, C.blueBg)}>
              <span style={s.statNum(C.blue)}>{opMetrics.servicesCompleted}</span>
              <span style={s.statLabel}>Services Done</span>
            </div>
          </div>

          <div style={s.card}>
            <h2 style={s.h2}>Faults by Category</h2>
            {Object.keys(opMetrics.faultsByCategory).length === 0 ? (
              <div style={{ fontSize: 13, color: C.textMuted }}>No faults in this period.</div>
            ) : (
              Object.entries(opMetrics.faultsByCategory)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, count]) => <BarRow key={cat} label={cat} value={count} max={maxCategory} color={C.accent} />)
            )}
          </div>

          <div style={s.card}>
            <h2 style={s.h2}>Faults by Severity</h2>
            <BarRow label="Critical" value={opMetrics.faultsBySeverity.Critical} max={Math.max(1, ...Object.values(opMetrics.faultsBySeverity))} color={C.red} />
            <BarRow label="Service Required" value={opMetrics.faultsBySeverity["Service Required"]} max={Math.max(1, ...Object.values(opMetrics.faultsBySeverity))} color={C.yellow} />
            <BarRow label="Monitor" value={opMetrics.faultsBySeverity.Monitor} max={Math.max(1, ...Object.values(opMetrics.faultsBySeverity))} color={C.blue} />
          </div>

          <div style={s.card}>
            <h2 style={s.h2}>Resolution Status</h2>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1, ...s.statCard(C.red, C.redBg) }}>
                <span style={s.statNum(C.red)}>{opMetrics.openFaults}</span>
                <span style={s.statLabel}>Still Open</span>
              </div>
              <div style={{ flex: 1, ...s.statCard(C.green, C.greenBg) }}>
                <span style={s.statNum(C.green)}>{opMetrics.resolvedFaults}</span>
                <span style={s.statLabel}>Resolved</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* FINANCIAL */}
      {reportType === "financial" && (
        <>
          <div style={{ ...s.grid(3), marginBottom: 16 }}>
            <div style={s.statCard(C.accent, C.accentGlow)}>
              <span style={{ ...s.statNum(C.accent), fontSize: 24 }}>${finMetrics.totalPartsCost.toFixed(0)}</span>
              <span style={s.statLabel}>Parts Cost (Period)</span>
            </div>
            <div style={s.statCard(C.green, C.greenBg)}>
              <span style={{ ...s.statNum(C.green), fontSize: 24 }}>${finMetrics.inventoryValue.toFixed(0)}</span>
              <span style={s.statLabel}>Inventory Value</span>
            </div>
            <div style={s.statCard(C.blue, C.blueBg)}>
              <span style={s.statNum(C.blue)}>{finMetrics.topParts.reduce((s, p) => s + p.qty, 0)}</span>
              <span style={s.statLabel}>Parts Used</span>
            </div>
          </div>

          <div style={s.card}>
            <h2 style={s.h2}>Top Parts Used (by cost)</h2>
            {finMetrics.topParts.length === 0 ? (
              <div style={{ fontSize: 13, color: C.textMuted }}>No parts used in this period.</div>
            ) : (
              <table style={s.table}>
                <thead><tr>{["Part", "Qty", "Cost"].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {finMetrics.topParts.slice(0, 10).map((p, i) => (
                    <tr key={i}>
                      <td style={{ ...s.td, fontWeight: 500 }}>{p.name}</td>
                      <td style={{ ...s.td, fontFamily: MONO }}>{p.qty}</td>
                      <td style={{ ...s.td, fontFamily: MONO, color: C.accent, fontWeight: 700 }}>${p.cost.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={s.card}>
            <h2 style={s.h2}>Completed Services with Costs</h2>
            {periodServices.filter((sv) => sv.completedDate).length === 0 ? (
              <div style={{ fontSize: 13, color: C.textMuted }}>No completed services in this period.</div>
            ) : (
              <table style={s.table}>
                <thead><tr>{["Date", "Bike", "Type", "Parts Cost", "Time"].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {periodServices.filter((sv) => sv.completedDate).map((sv) => {
                    const bike = bikes.find((b) => b.id === sv.bikeId);
                    const cost = (sv.partsUsed || []).reduce((s, pu) => s + (pu.cost || 0) * pu.qty, 0);
                    return (
                      <tr key={sv.id}>
                        <td style={{ ...s.td, fontSize: 12 }}>{fmtDate(sv.completedDate)}</td>
                        <td style={s.td}>{bike?.name || sv.bikeId}</td>
                        <td style={{ ...s.td, color: C.textMuted, fontSize: 12 }}>{sv.serviceType}</td>
                        <td style={{ ...s.td, fontFamily: MONO, color: C.accent, fontWeight: 600 }}>${cost.toFixed(2)}</td>
                        <td style={{ ...s.td, fontSize: 12, color: C.textMuted }}>{sv.timeSpent || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* FLEET HEALTH */}
      {reportType === "fleet-health" && (
        <>
          <div style={{ ...s.grid(4), marginBottom: 16 }}>
            <div style={s.statCard(C.red, C.redBg)}>
              <span style={s.statNum(C.red)}>{healthMetrics.recurring.length}</span>
              <span style={s.statLabel}>Recurring Bikes</span>
            </div>
            <div style={s.statCard(C.yellow, C.yellowBg)}>
              <span style={s.statNum(C.yellow)}>{healthMetrics.batteryFaults}</span>
              <span style={s.statLabel}>Battery Faults</span>
            </div>
            <div style={s.statCard(C.purple, C.purpleBg)}>
              <span style={s.statNum(C.purple)}>{healthMetrics.problemBatteries}</span>
              <span style={s.statLabel}>Problem Batteries</span>
            </div>
            <div style={s.statCard(C.blue, C.blueBg)}>
              <span style={s.statNum(C.blue)}>{healthMetrics.problemBikes.length}</span>
              <span style={s.statLabel}>Bikes with Faults</span>
            </div>
          </div>

          {healthMetrics.recurring.length > 0 && (
            <div style={{ ...s.card, background: C.redBg, borderColor: C.red + "44" }}>
              <h2 style={{ ...s.h2, color: C.red }}>⚠ Recurring Problem Bikes (3+ faults in period)</h2>
              {healthMetrics.recurring.map((b) => (
                <div key={b.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                  <span><strong>{b.name}</strong> <span style={{ color: C.textMuted }}>• {b.category}</span></span>
                  <span style={s.badge(C.red)}>{b.count} faults</span>
                </div>
              ))}
            </div>
          )}

          <div style={s.card}>
            <h2 style={s.h2}>All Problem Bikes (ranked)</h2>
            {healthMetrics.problemBikes.length === 0 ? (
              <div style={{ fontSize: 13, color: C.textMuted }}>No faults recorded for any bike in this period.</div>
            ) : (
              healthMetrics.problemBikes.slice(0, 15).map((b) => (
                <BarRow key={b.id} label={`${b.name} (${b.category})`} value={b.count} max={maxProblemBike} color={b.count >= 3 ? C.red : C.yellow} />
              ))
            )}
          </div>

          <div style={s.card}>
            <h2 style={s.h2}>Faults by Bike Category</h2>
            <table style={s.table}>
              <thead><tr>{["Category", "Bikes", "Faults", "Per Bike"].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {Object.entries(healthMetrics.categoryStats).map(([cat, st]) => (
                  <tr key={cat}>
                    <td style={{ ...s.td, fontWeight: 500 }}>{cat}</td>
                    <td style={{ ...s.td, fontFamily: MONO }}>{st.total}</td>
                    <td style={{ ...s.td, fontFamily: MONO }}>{st.faults}</td>
                    <td style={{ ...s.td, fontFamily: MONO, color: st.total > 0 && st.faults / st.total > 1 ? C.red : C.text, fontWeight: 700 }}>
                      {st.total > 0 ? (st.faults / st.total).toFixed(2) : "0"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
