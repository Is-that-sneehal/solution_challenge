import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import axios from "axios";
import { MapContainer, TileLayer, Marker, Polyline, Circle, useMap, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix for default marker icons in Leaflet + React
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;
import {
  AlertTriangle,
  BarChart3,
  Moon,
  Download,
  LocateFixed,
  MapPin,
  Minus,
  Sun,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Ship,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Suggestion = { description: string; placeId?: string };
type RouteData = { id: string; label: string; distanceKm: number; durationHours: number; polyline?: string; waypoints?: Coord[] };
type Coord = { lat: number; lng: number };
type Analysis = {
  source: string;
  fallbackLabel?: string;
  delayProbability: number;
  classification: "Low" | "Medium" | "High";
  contributors: { name: string; value: number }[];
  riskNumbers?: Record<string, number>;
  recommendation: string;
  explanation: string;
  insurance: { basePremium: number; adjustedPremium: number; adjustedRatePct: number };
  cost: { transportCost: number; riskCost: number; timeCost: number; distanceCost: number; expectedProfit: number };
  smartPorts: { name: string; congestion: number; capacity: number; risk: number; shipCompatible: boolean; waitHours: number; score: number }[];
  recoveryPlan: { nearestWarehouse: string; alternateModes: string[]; potentialDelayReductionHours: number; potentialSavings: number; suggestedPort: string };
  riskZones: { name: string; lat: number; lng: number; radiusKm: number; weight: number }[];
  standardRoutes?: { id: string; name: string; baselineRisk: number; distanceFromRouteKm: number; proximityScore: number; used: boolean }[];
};

const api = axios.create({ baseURL: "/api" });
const defaultOrigin: Coord = { lat: 18.93, lng: 72.84 }; // Mumbai
const defaultDestination: Coord = { lat: 51.92, lng: 4.47 }; // Rotterdam
const defaultForm = {
  origin: "",
  destination: "",
  cargoType: "electronics",
  carrierCountry: "IN",
  shipSize: "medium",
  shipmentValue: 1000000,
};
const countries = ["IN", "US", "CN", "AE", "NL", "SG", "JP", "DE", "BR"];
const tabs = ["Route Comparison", "Port Selection", "Financial Impact", "Recovery Plan", "What-If Simulation"] as const;

// ─── Supported Demo Ports ────────────────────────────────────────
const DEMO_PORTS: Record<string, Coord> = {
  "mumbai port": { lat: 18.95, lng: 72.84 },
  "dubai port": { lat: 25.01, lng: 55.06 },
  "jebel ali port": { lat: 25.01, lng: 55.06 },
  "rotterdam port": { lat: 51.95, lng: 4.14 },
  "hamburg port": { lat: 53.54, lng: 9.99 },
  "singapore port": { lat: 1.26, lng: 103.84 },
  "chennai port": { lat: 13.10, lng: 80.29 },
  "cape town port": { lat: -33.92, lng: 18.42 },
  "melbourne port": { lat: -37.84, lng: 144.92 },
};

function resolveDemo(input: string): { key: string; coord: Coord } | null {
  const n = input.toLowerCase().trim();
  for (const [key, coord] of Object.entries(DEMO_PORTS)) {
    if (n.includes(key) || key.includes(n)) return { key, coord };
  }
  return null;
}

// ─── Fixed Demo Route Waypoints (3 options per corridor) ─────────
type RouteTemplate = { id: string; label: string; waypoints: Coord[]; distanceKm: number; durationHours: number; riskPct: number; explanation: string };
type CorridorSet = RouteTemplate[];

const DEMO_CORRIDORS: Record<string, CorridorSet> = {
  "mumbai port→rotterdam port": [
    { id: "suez", label: "Suez Canal (Fastest)", waypoints: [{lat:18.95,lng:72.84},{lat:14,lng:65},{lat:12,lng:45},{lat:18,lng:40},{lat:30,lng:32},{lat:36,lng:18},{lat:51.95,lng:4.14}], distanceKm: 11200, durationHours: 336, riskPct: 68, explanation: "Fastest route via Suez Canal. Higher geopolitical risk due to Red Sea corridor." },
    { id: "cape", label: "Cape of Good Hope (Safer)", waypoints: [{lat:18.95,lng:72.84},{lat:10,lng:65},{lat:-5,lng:55},{lat:-20,lng:30},{lat:-35,lng:18},{lat:-20,lng:0},{lat:20,lng:-12},{lat:40,lng:-8},{lat:51.95,lng:4.14}], distanceKm: 15400, durationHours: 480, riskPct: 18, explanation: "Safest route avoiding all conflict zones. Longer transit but minimal risk exposure." },
    { id: "balanced", label: "Balanced Route", waypoints: [{lat:18.95,lng:72.84},{lat:12,lng:60},{lat:10,lng:48},{lat:20,lng:38},{lat:32,lng:30},{lat:38,lng:15},{lat:51.95,lng:4.14}], distanceKm: 12800, durationHours: 396, riskPct: 40, explanation: "Balanced route offering good profitability with moderate risk." },
  ],
  "mumbai port→dubai port": [
    { id: "direct", label: "Direct Arabian Sea", waypoints: [{lat:18.95,lng:72.84},{lat:20,lng:68},{lat:23,lng:60},{lat:25.01,lng:55.06}], distanceKm: 1900, durationHours: 72, riskPct: 15, explanation: "Direct short route across Arabian Sea. Minimal risk." },
    { id: "coastal", label: "Coastal Route", waypoints: [{lat:18.95,lng:72.84},{lat:22,lng:69},{lat:24,lng:65},{lat:25,lng:58},{lat:25.01,lng:55.06}], distanceKm: 2200, durationHours: 84, riskPct: 8, explanation: "Hugs coastline for safer passage with port accessibility." },
    { id: "offshore", label: "Offshore Route", waypoints: [{lat:18.95,lng:72.84},{lat:18,lng:66},{lat:21,lng:58},{lat:25.01,lng:55.06}], distanceKm: 2100, durationHours: 78, riskPct: 12, explanation: "Offshore path avoiding coastal congestion." },
  ],
  "mumbai port→jebel ali port": [
    { id: "direct", label: "Direct Arabian Sea", waypoints: [{lat:18.95,lng:72.84},{lat:20,lng:68},{lat:23,lng:60},{lat:25.01,lng:55.06}], distanceKm: 1900, durationHours: 72, riskPct: 15, explanation: "Direct short route across Arabian Sea." },
    { id: "coastal", label: "Coastal Route", waypoints: [{lat:18.95,lng:72.84},{lat:22,lng:69},{lat:24,lng:65},{lat:25,lng:58},{lat:25.01,lng:55.06}], distanceKm: 2200, durationHours: 84, riskPct: 8, explanation: "Hugs coastline for safer passage." },
    { id: "offshore", label: "Offshore Route", waypoints: [{lat:18.95,lng:72.84},{lat:18,lng:66},{lat:21,lng:58},{lat:25.01,lng:55.06}], distanceKm: 2100, durationHours: 78, riskPct: 12, explanation: "Offshore path avoiding coastal congestion." },
  ],
  "jebel ali port→hamburg port": [
    { id: "suez", label: "Suez Canal (Fastest)", waypoints: [{lat:25.01,lng:55.06},{lat:20,lng:50},{lat:12,lng:45},{lat:18,lng:40},{lat:30,lng:32},{lat:36,lng:18},{lat:53.54,lng:9.99}], distanceKm: 12500, durationHours: 384, riskPct: 65, explanation: "Fastest via Suez. Elevated risk in Red Sea region." },
    { id: "cape", label: "Cape of Good Hope (Safer)", waypoints: [{lat:25.01,lng:55.06},{lat:15,lng:55},{lat:-5,lng:50},{lat:-25,lng:30},{lat:-35,lng:18},{lat:-15,lng:0},{lat:25,lng:-15},{lat:45,lng:-5},{lat:53.54,lng:9.99}], distanceKm: 18000, durationHours: 552, riskPct: 15, explanation: "Safe Cape route. Avoids all conflict zones." },
    { id: "balanced", label: "Balanced Route", waypoints: [{lat:25.01,lng:55.06},{lat:18,lng:48},{lat:15,lng:42},{lat:25,lng:35},{lat:35,lng:22},{lat:42,lng:10},{lat:53.54,lng:9.99}], distanceKm: 14200, durationHours: 432, riskPct: 38, explanation: "Moderate risk with reasonable transit time." },
  ],
  "dubai port→hamburg port": [
    { id: "suez", label: "Suez Canal (Fastest)", waypoints: [{lat:25.01,lng:55.06},{lat:20,lng:50},{lat:12,lng:45},{lat:18,lng:40},{lat:30,lng:32},{lat:36,lng:18},{lat:53.54,lng:9.99}], distanceKm: 12500, durationHours: 384, riskPct: 65, explanation: "Fastest via Suez. Elevated risk." },
    { id: "cape", label: "Cape of Good Hope (Safer)", waypoints: [{lat:25.01,lng:55.06},{lat:15,lng:55},{lat:-5,lng:50},{lat:-25,lng:30},{lat:-35,lng:18},{lat:-15,lng:0},{lat:25,lng:-15},{lat:45,lng:-5},{lat:53.54,lng:9.99}], distanceKm: 18000, durationHours: 552, riskPct: 15, explanation: "Safe Cape route bypassing conflict zones." },
    { id: "balanced", label: "Balanced Route", waypoints: [{lat:25.01,lng:55.06},{lat:18,lng:48},{lat:15,lng:42},{lat:25,lng:35},{lat:35,lng:22},{lat:42,lng:10},{lat:53.54,lng:9.99}], distanceKm: 14200, durationHours: 432, riskPct: 38, explanation: "Moderate risk with good efficiency." },
  ],
  "singapore port→chennai port": [
    { id: "direct", label: "Direct Bay of Bengal", waypoints: [{lat:1.26,lng:103.84},{lat:5,lng:95},{lat:8,lng:88},{lat:13.10,lng:80.29}], distanceKm: 2800, durationHours: 96, riskPct: 12, explanation: "Direct route with low risk across Bay of Bengal." },
    { id: "coastal", label: "Coastal Malacca Route", waypoints: [{lat:1.26,lng:103.84},{lat:3,lng:100},{lat:6,lng:94},{lat:9,lng:85},{lat:13.10,lng:80.29}], distanceKm: 3100, durationHours: 108, riskPct: 8, explanation: "Coastal route hugging shoreline for safety." },
    { id: "offshore", label: "Offshore Route", waypoints: [{lat:1.26,lng:103.84},{lat:4,lng:98},{lat:7,lng:90},{lat:10,lng:83},{lat:13.10,lng:80.29}], distanceKm: 3000, durationHours: 102, riskPct: 10, explanation: "Offshore path avoiding congestion zones." },
  ],
  "mumbai port→melbourne port": [
    { id: "direct", label: "Direct Indian Ocean", waypoints: [{lat:18.95,lng:72.84},{lat:10,lng:70},{lat:-10,lng:90},{lat:-25,lng:115},{lat:-37.84,lng:144.92}], distanceKm: 9200, durationHours: 288, riskPct: 20, explanation: "Direct route maximizing profit through shortest path." },
    { id: "singapore", label: "Via Singapore (Lower Congestion)", waypoints: [{lat:18.95,lng:72.84},{lat:8,lng:78},{lat:1.5,lng:104},{lat:-10,lng:115},{lat:-25,lng:130},{lat:-37.84,lng:144.92}], distanceKm: 10800, durationHours: 336, riskPct: 10, explanation: "Routes via Singapore for lower congestion and port options." },
    { id: "southern", label: "Southern Route (Weather Safer)", waypoints: [{lat:18.95,lng:72.84},{lat:5,lng:75},{lat:-15,lng:85},{lat:-30,lng:110},{lat:-38,lng:130},{lat:-37.84,lng:144.92}], distanceKm: 10200, durationHours: 312, riskPct: 14, explanation: "Southern path avoiding monsoon zones for weather safety." },
  ],
  "rotterdam port→cape town port": [
    { id: "atlantic", label: "Atlantic Direct", waypoints: [{lat:51.95,lng:4.14},{lat:40,lng:-5},{lat:20,lng:-15},{lat:0,lng:-10},{lat:-20,lng:5},{lat:-33.92,lng:18.42}], distanceKm: 11100, durationHours: 360, riskPct: 18, explanation: "Direct Atlantic route with minimal detours." },
    { id: "coastal_africa", label: "West Africa Coastal", waypoints: [{lat:51.95,lng:4.14},{lat:42,lng:-8},{lat:28,lng:-15},{lat:15,lng:-18},{lat:0,lng:-5},{lat:-15,lng:8},{lat:-33.92,lng:18.42}], distanceKm: 12200, durationHours: 396, riskPct: 22, explanation: "Follows West Africa coast with port access options." },
    { id: "offshore_west", label: "Offshore Western", waypoints: [{lat:51.95,lng:4.14},{lat:38,lng:-12},{lat:18,lng:-22},{lat:-5,lng:-18},{lat:-22,lng:0},{lat:-33.92,lng:18.42}], distanceKm: 11800, durationHours: 384, riskPct: 15, explanation: "Offshore western route for best weather conditions." },
  ],
  "chennai port→singapore port": [
    { id: "direct", label: "Direct Bay of Bengal", waypoints: [{lat:13.10,lng:80.29},{lat:8,lng:88},{lat:5,lng:95},{lat:1.26,lng:103.84}], distanceKm: 2800, durationHours: 96, riskPct: 12, explanation: "Direct route with efficient transit time." },
    { id: "coastal", label: "Coastal Route", waypoints: [{lat:13.10,lng:80.29},{lat:10,lng:85},{lat:6,lng:94},{lat:3,lng:100},{lat:1.26,lng:103.84}], distanceKm: 3100, durationHours: 108, riskPct: 8, explanation: "Coastal path for maximum safety." },
    { id: "nicobar", label: "Via Nicobar Islands", waypoints: [{lat:13.10,lng:80.29},{lat:10,lng:86},{lat:8,lng:92},{lat:4,lng:98},{lat:1.26,lng:103.84}], distanceKm: 3000, durationHours: 102, riskPct: 10, explanation: "Routes via Nicobar passage for balanced efficiency." },
  ],
};

function findCorridor(originKey: string, destKey: string): CorridorSet | null {
  return DEMO_CORRIDORS[`${originKey}→${destKey}`] || null;
}



function buildAnalysis(route: RouteData, shipmentValue: number, riskPct: number, explanation: string): Analysis {
  const riskCost = Math.round((riskPct / 100) * shipmentValue * 0.2);
  const timeCost = Math.round(route.durationHours * 500);
  const distanceCost = Math.round(route.distanceKm * 0.3);
  const expectedProfit = shipmentValue - riskCost - timeCost - distanceCost;
  const classification: "Low"|"Medium"|"High" = riskPct > 50 ? "High" : riskPct > 25 ? "Medium" : "Low";
  const insurance_cost = shipmentValue * (0.005 + (riskPct / 100) * 0.01);
  return {
    source: "RouteOptix Intelligence",
    delayProbability: riskPct,
    classification,
    contributors: [
      { name: "Geopolitical", value: classification === "High" ? 75 : classification === "Medium" ? 40 : 15 },
      { name: "Weather", value: classification === "High" ? 45 : 25 },
      { name: "Congestion", value: classification === "High" ? 60 : 30 },
      { name: "Piracy", value: classification === "High" ? 55 : 5 },
    ],
    recommendation: expectedProfit > shipmentValue * 0.7 ? "Recommended route offers best profitability despite slightly longer distance." : riskPct > 50 ? "Consider re-routing via safer corridor to improve profitability." : "Proceed with standard precautions.",
    explanation,
    insurance: { basePremium: Math.round(shipmentValue * 0.005), adjustedPremium: Math.round(insurance_cost), adjustedRatePct: Number(((insurance_cost / shipmentValue) * 100).toFixed(2)) },
    cost: { transportCost: Math.round(route.distanceKm * 0.5), riskCost, timeCost, distanceCost, expectedProfit },
    smartPorts: [],
    recoveryPlan: { nearestWarehouse: "Primary Hub", alternateModes: ["Air", "Rail"], potentialDelayReductionHours: 24, potentialSavings: 25000, suggestedPort: "Nearest Hub" },
    riskZones: [],
  };
}


export default function App() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem("routeoptix-theme");
    return saved ? saved === "dark" : false;
  });
  const [form, setForm] = useState(defaultForm);
  const [originSuggestions, setOriginSuggestions] = useState<Suggestion[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<Suggestion[]>([]);
  const [routeSource, setRouteSource] = useState("estimated");
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  const [originCoord, setOriginCoord] = useState(defaultOrigin);
  const [destinationCoord, setDestinationCoord] = useState(defaultDestination);
  const [mapView, setMapView] = useState<"route" | "risk" | "ports">("route");
  const [mapZoom, setMapZoom] = useState(3);
  const [tab, setTab] = useState<(typeof tabs)[number]>("Route Comparison");
  const [loading, setLoading] = useState(false);
  const [whatIf, setWhatIf] = useState({ weather: 0.45, congestion: 0.52, geopolitical: 0.48, shadowFleet: 0.44 });
  const [selectedRouteId, setSelectedRouteId] = useState<string>("");
  const [geocodingError, setGeocodingError] = useState<string | null>(null);

  const selectedAnalysis = analyses[selectedRouteId] || analyses[routes[0]?.id || ""] || null;



  const fetchSuggestions = async (input: string, field: "origin" | "destination") => {
    try {
      const { data } = await api.get("/places/autocomplete", { params: { input } });
      if (field === "origin") setOriginSuggestions(data.predictions || []);
      else setDestinationSuggestions(data.predictions || []);
    } catch {
      if (field === "origin") setOriginSuggestions([]);
      else setDestinationSuggestions([]);
    }
  };

  const analyzeSingleRoute = async (route: RouteData, nextForm = form, nextWhatIf = whatIf, origin = originCoord) => {
    const { data } = await api.post("/intelligence/analyze", {
      shipment: nextForm,
      route,
      whatIf: nextWhatIf,
      coordinates: origin,
    });
    return data as Analysis;
  };

  const analyzeRoute = async () => {
    if (!form.origin || !form.destination) return;
    setLoading(true);
    setGeocodingError(null);
    try {
      const orig = resolveDemo(form.origin);
      const dest = resolveDemo(form.destination);
      if (!orig || !dest) { setGeocodingError("This corridor is not supported in the demo version yet."); setLoading(false); return; }

      const corridorSet = findCorridor(orig.key, dest.key);
      if (!corridorSet) { setGeocodingError("This corridor is not supported in the demo version yet."); setLoading(false); return; }

      // Build routes from templates
      const computedRoutes: RouteData[] = corridorSet.map(t => ({
        id: t.id, label: t.label, distanceKm: t.distanceKm, durationHours: t.durationHours, waypoints: t.waypoints,
      }));
      setRoutes(computedRoutes);
      setOriginCoord(orig.coord);
      setDestinationCoord(dest.coord);
      setRouteSource("RouteOptix Intelligence");

      // Build analyses locally with profit model
      const mapped: Record<string, Analysis> = {};
      corridorSet.forEach(t => {
        const route = computedRoutes.find(r => r.id === t.id)!;
        mapped[t.id] = buildAnalysis(route, form.shipmentValue, t.riskPct, t.explanation);
      });
      setAnalyses(mapped);

      // Select route with HIGHEST expected profit
      const recommended = computedRoutes.reduce((best, r) =>
        (mapped[r.id]?.cost?.expectedProfit || 0) > (mapped[best.id]?.cost?.expectedProfit || 0) ? r : best
      );
      setSelectedRouteId(recommended.id);
    } catch (err) {
      console.error("Analysis failed", err);
      setGeocodingError("Analysis failed. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };



  const resetForm = () => {
    setForm(defaultForm);
    setRoutes([]);
    setAnalyses({});
    setOriginSuggestions([]);
    setDestinationSuggestions([]);
    setSelectedRouteId("");
    setWhatIf({ weather: 0.45, congestion: 0.52, geopolitical: 0.48, shadowFleet: 0.44 });
  };

  const clearForm = () => {
    setForm({ ...defaultForm, origin: "", destination: "", shipmentValue: 0 });
    setOriginSuggestions([]);
    setDestinationSuggestions([]);
  };

  const zoomIn = () => setMapZoom((prev) => Math.min(15, prev + 1));
  const zoomOut = () => setMapZoom((prev) => Math.max(1, prev - 1));
  const resetZoom = () => setMapZoom(3);

  const exportReport = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      shipment: form,
      routeSource,
      selectedRouteId,
      analyses,
      whatIf,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "routeoptix-report.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!routes.length) return;
    const timer = setTimeout(async () => {
      const refreshed = await Promise.all(routes.map((route) => analyzeSingleRoute(route)));
      setAnalyses(
        routes.reduce<Record<string, Analysis>>((acc, route, index) => {
          acc[route.id] = refreshed[index];
          return acc;
        }, {})
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [whatIf]);

  const chartFinancial = selectedAnalysis
    ? [
        { name: "Risk Cost", value: selectedAnalysis.cost.riskCost },
        { name: "Time Cost", value: selectedAnalysis.cost.timeCost },
        { name: "Distance Cost", value: selectedAnalysis.cost.distanceCost },
      ]
    : [];

  useEffect(() => {
    localStorage.setItem("routeoptix-theme", isDark ? "dark" : "light");
  }, [isDark]);

  return (
    <div className={isDark ? "dark" : ""}>
      <div className="min-h-screen bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white px-5 py-4 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100">RouteOptix</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">AI-powered maritime route intelligence</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Live Intelligence</span>
            <button
              onClick={() => setIsDark((prev) => !prev)}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
              {isDark ? "Light" : "Dark"}
            </button>
            <button onClick={resetForm} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"><RefreshCcw size={14} /> Reset</button>
            <button onClick={exportReport} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"><Download size={14} /> Export Report</button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-4 p-4">
        <aside className="col-span-3 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Ship size={16} /> Shipment Planner</h2>
          <AutoCompleteField
            label="Origin"
            value={form.origin}
            placeholder="Type any global port, city, or hub"
            suggestions={originSuggestions}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, origin: value }));
              fetchSuggestions(value, "origin");
            }}
            onSelect={(value) => {
              setForm((prev) => ({ ...prev, origin: value }));
              setOriginSuggestions([]);
            }}
            onDismiss={() => setOriginSuggestions([])}
          />
          <AutoCompleteField
            label="Destination"
            value={form.destination}
            placeholder="Type any global port, city, or hub"
            suggestions={destinationSuggestions}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, destination: value }));
              fetchSuggestions(value, "destination");
            }}
            onSelect={(value) => {
              setForm((prev) => ({ ...prev, destination: value }));
              setDestinationSuggestions([]);
            }}
            onDismiss={() => setDestinationSuggestions([])}
          />
          <SelectField label="Cargo Type" value={form.cargoType} onChange={(value) => setForm((prev) => ({ ...prev, cargoType: value }))} options={[
            { value: "oil", label: "Oil" },
            { value: "perishable", label: "Perishable Food" },
            { value: "electronics", label: "Electronics" },
            { value: "chemicals", label: "Chemicals" },
          ]} />
          <SelectField label="Carrier Country" value={form.carrierCountry} onChange={(value) => setForm((prev) => ({ ...prev, carrierCountry: value }))} options={countries.map((c) => ({ value: c, label: c }))} />
          <SelectField label="Ship Size" value={form.shipSize} onChange={(value) => setForm((prev) => ({ ...prev, shipSize: value }))} options={[
            { value: "small", label: "Small" },
            { value: "medium", label: "Medium" },
            { value: "large", label: "Large" },
          ]} />
          <label className="text-xs font-medium text-slate-600">
            Shipment Value
            <input type="number" value={form.shipmentValue} onChange={(e) => setForm((prev) => ({ ...prev, shipmentValue: Number(e.target.value || 0) }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-800" />
          </label>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button disabled={loading || !form.origin || !form.destination} onClick={analyzeRoute} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Analyze Route</button>
            <button onClick={clearForm} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium dark:border-slate-700 dark:bg-slate-800">Clear</button>
          </div>
        </aside>

        <section className="col-span-6 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700">Interactive Logistics Map</h3>
            <div className="flex items-center gap-2">
              <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs dark:bg-slate-800">
                <button onClick={() => setMapView("route")} className={`rounded-md px-3 py-1 ${mapView === "route" ? "bg-white shadow" : ""}`}>Route View</button>
                <button onClick={() => setMapView("risk")} className={`rounded-md px-3 py-1 ${mapView === "risk" ? "bg-white shadow" : ""}`}>Risk Heatmap</button>
                <button onClick={() => setMapView("ports")} className={`rounded-md px-3 py-1 ${mapView === "ports" ? "bg-white shadow" : ""}`}>Ports View</button>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <button onClick={zoomOut} className="rounded p-1.5 hover:bg-slate-100" title="Zoom out"><Minus size={14} /></button>
                <span className="min-w-10 text-center text-xs font-semibold text-slate-600">Z {mapZoom}</span>
                <button onClick={zoomIn} className="rounded p-1.5 hover:bg-slate-100" title="Zoom in"><Plus size={14} /></button>
                <button onClick={resetZoom} className="rounded p-1.5 hover:bg-slate-100" title="Reset zoom"><LocateFixed size={14} /></button>
              </div>
            </div>
          </div>
          <div className="relative h-[520px] w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <MapContainer
              center={[originCoord.lat, originCoord.lng] as L.LatLngExpression}
              zoom={mapZoom}
              style={{ height: "100%", width: "100%" }}
              zoomControl={false}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                className={isDark ? "map-tiles-dark" : ""}
              />
              <MapController center={originCoord} zoom={mapZoom} routes={routes} />
              <Marker position={[originCoord.lat, originCoord.lng] as L.LatLngExpression}>
                <Popup>Origin: {form.origin}</Popup>
              </Marker>
              <Marker position={[destinationCoord.lat, destinationCoord.lng] as L.LatLngExpression}>
                <Popup>Destination: {form.destination}</Popup>
              </Marker>
              
              {(mapView === "route" || mapView === "risk") &&
                routes.map((route, index) => (
                  <Polyline 
                    key={`${selectedRouteId}-${route.id}-${(route.waypoints||[]).length}`} 
                    positions={(route.waypoints || []).map(p => [p.lat, p.lng]) as L.LatLngExpression[]} 
                    pathOptions={{ 
                      color: selectedRouteId === route.id ? "#2563eb" : index === 1 ? "#10b981" : "#94a3b8", 
                      weight: selectedRouteId === route.id ? 6 : 3, 
                      opacity: selectedRouteId === route.id ? 0.9 : 0.4,
                      dashArray: selectedRouteId === route.id ? undefined : "5, 10"
                    }} 
                  />
                ))}
              {mapView === "risk" &&
                (selectedAnalysis?.riskZones || []).map((zone) => (
                  <Circle 
                    key={zone.name} 
                    center={[zone.lat, zone.lng] as L.LatLngExpression} 
                    radius={zone.radiusKm * 1000} 
                    pathOptions={{ fillColor: "#ef4444", fillOpacity: 0.15, color: "#dc2626", weight: 1 }} 
                  />
                ))}
              {mapView === "ports" &&
                (selectedAnalysis?.smartPorts || []).slice(0, 8).map((port, idx) => (
                  <Marker 
                    key={port.name} 
                    position={[originCoord.lat + (idx - 4) * 2, originCoord.lng + (idx - 4) * 3] as L.LatLngExpression}
                  >
                    <Popup>{port.name} (Congestion: {Math.round(port.congestion * 100)}%)</Popup>
                  </Marker>
                ))}
            </MapContainer>
            {geocodingError && (
              <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 text-center max-w-xs">
                  <AlertTriangle className="mx-auto mb-2 text-rose-500" size={24} />
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{geocodingError}</p>
                  <button onClick={() => setGeocodingError(null)} className="mt-3 text-xs font-semibold text-blue-600">Dismiss</button>
                </div>
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Route data source: <span className="font-semibold">{routeSource}</span>
            {selectedAnalysis?.fallbackLabel ? ` • ${selectedAnalysis.fallbackLabel}` : ""}
          </p>
        </section>

        <aside className="col-span-3 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {selectedAnalysis && (
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="rounded-xl bg-blue-600 p-4 text-white shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider opacity-80">Top Recommendation</span>
                <ShieldCheck size={18} />
              </div>
              <p className="mt-1 text-lg font-bold">{routes.find(r => r.id === selectedRouteId)?.label || "Recommended Route"}</p>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-bold">₹{(selectedAnalysis?.cost.expectedProfit || 0).toLocaleString()}</span>
                <span className="text-xs opacity-80">Expected Profit</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed opacity-90">
                {selectedAnalysis?.explanation} {selectedAnalysis?.recommendation}
              </p>
            </motion.div>
          )}

          <h2 className="flex items-center gap-2 text-base font-semibold pt-1"><ShieldCheck size={16} /> Intelligence Summary</h2>
          <motion.div layout className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
            <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Delay Risk Score</p>
            <div className="flex items-end justify-between">
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{selectedAnalysis?.delayProbability ?? 0}%</p>
              <p className={`text-sm font-semibold mb-1 ${selectedAnalysis?.classification === "High" ? "text-rose-600" : selectedAnalysis?.classification === "Medium" ? "text-amber-600" : "text-emerald-600"}`}>
                {selectedAnalysis?.classification || "Not analyzed"}
              </p>
            </div>
          </motion.div>

          <div className="space-y-2 pt-1">
            <p className="text-xs font-bold text-slate-500 uppercase px-1">Risk Breakdown</p>
            {selectedAnalysis?.contributors.map((c, i) => (
              <RiskBar key={c.name} label={c.name} value={c.value} color={i === 0 ? "bg-rose-500" : i === 1 ? "bg-blue-500" : i === 2 ? "bg-amber-500" : "bg-indigo-500"} />
            ))}
            <RiskBar label="Insurance Risk" value={selectedAnalysis?.insurance.adjustedRatePct || 0} color="bg-indigo-500" />
          </div>

          <InfoRow icon={<AlertTriangle size={14} />} title="AI Explanation" value={selectedAnalysis?.explanation || "Run analysis"} />
          <InfoRow icon={<MapPin size={14} />} title="Recommended Action" value={selectedAnalysis?.recommendation || "Not available"} />
          <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
            <p className="font-medium text-slate-900 dark:text-slate-100">Profitability</p>
            <div className="mt-1 space-y-1 text-xs">
              <div className="flex justify-between"><span>Risk Cost</span><span>₹{(selectedAnalysis?.cost.riskCost || 0).toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Time Cost</span><span>₹{(selectedAnalysis?.cost.timeCost || 0).toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Distance Cost</span><span>₹{(selectedAnalysis?.cost.distanceCost || 0).toLocaleString()}</span></div>
              <div className={`flex justify-between font-bold border-t border-slate-100 dark:border-slate-700 pt-1 mt-1 ${(selectedAnalysis?.cost.expectedProfit || 0) > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                <span>Expected Profit</span><span>₹{(selectedAnalysis?.cost.expectedProfit || 0).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </aside>

        <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex flex-wrap gap-2">
            {tabs.map((item) => (
              <button key={item} onClick={() => setTab(item)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === item ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>
                {item}
              </button>
            ))}
          </div>
          {tab === "Route Comparison" && (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-4">
                {routes.map((route) => {
                  const analysis = analyses[route.id];
                  const isRecommended = route.id === selectedRouteId;
                  const isSelected = selectedRouteId === route.id;
                  
                  return (
                    <button 
                      key={route.id} 
                      onClick={() => setSelectedRouteId(route.id)}
                      className={`relative overflow-hidden rounded-xl border p-4 transition-all ${
                        isSelected ? "border-blue-500 bg-blue-50/50 ring-1 ring-blue-500" : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      {isRecommended && (
                        <div className="absolute top-0 right-0 rounded-bl-lg bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase">
                          Recommended
                        </div>
                      )}
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{route.label}</p>
                      <div className="mt-2 grid grid-cols-2 gap-y-1 text-xs text-slate-600">
                        <span>Time:</span><span className="text-right font-medium">{Math.round(route.durationHours / 24)} days</span>
                        <span>Distance:</span><span className="text-right font-medium">{route.distanceKm.toLocaleString()} km</span>
                        <span>Risk:</span><span className={`text-right font-bold ${analysis?.delayProbability > 70 ? "text-rose-600" : "text-emerald-600"}`}>{analysis?.delayProbability}%</span>
                        <span>Profit:</span><span className={`text-right font-bold ${(analysis?.cost.expectedProfit || 0) > (form.shipmentValue * 0.5) ? "text-emerald-600" : (analysis?.cost.expectedProfit || 0) > 0 ? "text-amber-600" : "text-rose-600"}`}>₹{(analysis?.cost.expectedProfit || 0).toLocaleString()}</span>
                      </div>
                      <div className="mt-3 flex gap-1">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${analysis?.classification === "High" ? "bg-rose-100 text-rose-700" : analysis?.classification === "Medium" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                          {analysis?.classification || "--"} Risk
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 uppercase font-bold tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Route Option</th>
                      <th className="px-4 py-3">Transit Time</th>
                      <th className="px-4 py-3">Risk Level</th>
                      <th className="px-4 py-3">Insurance</th>
                      <th className="px-4 py-3">Expected Profit</th>
                      <th className="px-4 py-3">Verdict</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {routes.map(r => {
                      const ana = analyses[r.id];
                      return (
                        <tr key={r.id} className={selectedRouteId === r.id ? "bg-blue-50/20" : ""}>
                          <td className="px-4 py-3 font-semibold">{r.label}</td>
                          <td className="px-4 py-3">{Math.round(r.durationHours / 24)} days</td>
                          <td className={`px-4 py-3 ${ana?.delayProbability < 30 ? "text-emerald-600 font-bold" : ana?.delayProbability > 70 ? "text-rose-600" : ""}`}>{ana?.delayProbability}%</td>
                          <td className="px-4 py-3">₹{(ana?.insurance.adjustedPremium || 0).toLocaleString()}</td>
                          <td className={`px-4 py-3 font-bold ${(ana?.cost.expectedProfit || 0) > (form.shipmentValue * 0.5) ? "text-emerald-600" : (ana?.cost.expectedProfit || 0) > 0 ? "text-amber-600" : "text-rose-600"}`}>₹{(ana?.cost.expectedProfit || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 italic opacity-70">
                            {ana?.recommendation || "--"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {tab === "Port Selection" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                {(selectedAnalysis?.smartPorts || []).slice(0, 6).map((port) => (
                  <div key={port.name} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <p className="font-semibold">{port.name}</p>
                    <p>Congestion: {(port.congestion * 100).toFixed(0)}% • Capacity: {(port.capacity * 100).toFixed(0)}%</p>
                    <p>Risk: {(port.risk * 100).toFixed(0)}% • Wait: {port.waitHours}h • Score: {port.score}</p>
                  </div>
                ))}
              </div>
              <ChartCard title="Port Risk Mix">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={(selectedAnalysis?.smartPorts || []).slice(0, 4).map((p) => ({ name: p.name.slice(0, 12), value: Math.round(p.risk * 100) }))} dataKey="value" nameKey="name" outerRadius={80}>
                      {["#2563eb", "#10b981", "#f59e0b", "#ef4444"].map((color) => <Cell key={color} fill={color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          )}
          {tab === "Financial Impact" && (
            <div className="grid grid-cols-2 gap-4">
              <ChartCard title="Cost Factors">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartFinancial}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#059669" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <div className="rounded-lg border border-slate-200 p-4 text-sm">
                <p className="font-semibold">Profitability Summary</p>
                <p>Shipment Value: ₹{form.shipmentValue.toLocaleString()}</p>
                <p>Risk Cost: ₹{(selectedAnalysis?.cost.riskCost || 0).toLocaleString()}</p>
                <p>Time Cost: ₹{(selectedAnalysis?.cost.timeCost || 0).toLocaleString()}</p>
                <p>Distance Cost: ₹{(selectedAnalysis?.cost.distanceCost || 0).toLocaleString()}</p>
                <p className={`mt-2 text-base font-semibold ${(selectedAnalysis?.cost.expectedProfit || 0) > 0 ? "text-emerald-600" : "text-rose-600"}`}>Expected Profit: ₹{(selectedAnalysis?.cost.expectedProfit || 0).toLocaleString()}</p>
              </div>
            </div>
          )}
          {tab === "Recovery Plan" && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="font-semibold">Multi-Modal Recovery</p>
                <p className="mt-1">Nearest warehouse: {selectedAnalysis?.recoveryPlan.nearestWarehouse || "-"}</p>
                <p>Suggested port: {selectedAnalysis?.recoveryPlan.suggestedPort || "-"}</p>
                <p>Delay reduction: {selectedAnalysis?.recoveryPlan.potentialDelayReductionHours || 0} hours</p>
                <p className="text-emerald-600">Potential savings: ₹{(selectedAnalysis?.recoveryPlan.potentialSavings || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="mb-1 font-semibold">Standard Maritime Routes</p>
                {(selectedAnalysis?.standardRoutes || []).slice(0, 6).map((route) => (
                  <div key={route.id} className="mb-1 flex items-center justify-between text-xs">
                    <span>{route.name}{route.used ? " (nearby)" : ""}</span>
                    <span>risk {Math.round(route.baselineRisk * 100)}%</span>
                  </div>
                ))}
                <p className="mb-1 mt-3 font-semibold">Alternative Modes</p>
                {(selectedAnalysis?.recoveryPlan.alternateModes || []).map((mode) => (
                  <p key={mode} className="text-xs">- {mode}</p>
                ))}
              </div>
            </div>
          )}
          {tab === "What-If Simulation" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-200 p-4">
                <Slider label="Weather Risk" value={whatIf.weather} onChange={(value) => setWhatIf((prev) => ({ ...prev, weather: value }))} />
                <Slider label="Port Congestion" value={whatIf.congestion} onChange={(value) => setWhatIf((prev) => ({ ...prev, congestion: value }))} />
                <Slider label="Geopolitical Tension" value={whatIf.geopolitical} onChange={(value) => setWhatIf((prev) => ({ ...prev, geopolitical: value }))} />
                <Slider label="Shadow Fleet Risk" value={whatIf.shadowFleet} onChange={(value) => setWhatIf((prev) => ({ ...prev, shadowFleet: value }))} />
              </div>
              <div className="rounded-lg border border-slate-200 p-4 text-sm">
                <p className="mb-2 flex items-center gap-2 font-semibold"><BarChart3 size={14} /> Live Simulation Output</p>
                <p>Delay Probability: {selectedAnalysis?.delayProbability || 0}%</p>
                <p>Risk Class: {selectedAnalysis?.classification || "-"}</p>
                <p>Adjusted Premium: ₹{(selectedAnalysis?.insurance.adjustedPremium || 0).toLocaleString()}</p>
                <p className={`font-semibold ${(selectedAnalysis?.cost.expectedProfit || 0) > 0 ? "text-emerald-600" : "text-rose-600"}`}>Expected Profit: ₹{(selectedAnalysis?.cost.expectedProfit || 0).toLocaleString()}</p>
                <p className="mt-2 text-slate-600">{selectedAnalysis?.recommendation || "-"}</p>
              </div>
            </div>
          )}
        </section>
      </div>
      </div>
    </div>
  );
}

function AutoCompleteField({
  label,
  value,
  placeholder,
  suggestions,
  onChange,
  onSelect,
  onDismiss,
}: {
  label: string;
  value: string;
  placeholder: string;
  suggestions: Suggestion[];
  onChange: (value: string) => void;
  onSelect: (value: string) => void;
  onDismiss: () => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const showSuggestions = isFocused && suggestions.length > 0 && value.trim().length > 0;

  return (
    <div>
      <label className="text-xs font-medium text-slate-600">
        {label}
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            setTimeout(() => {
              setIsFocused(false);
              onDismiss();
            }, 120);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setIsFocused(false);
              onDismiss();
            }
          }}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </label>
      {showSuggestions && (
        <div className="mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          {suggestions.map((item) => (
            <button
              key={`${item.description}-${item.placeId || ""}`}
              onClick={() => {
                onSelect(item.description);
                setIsFocused(false);
                onDismiss();
              }}
              className="block w-full border-b border-slate-100 px-3 py-2 text-left text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700"
            >
              {item.description}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RiskBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="px-1">
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-slate-600 dark:text-slate-400">{label}</span>
        <span className="font-bold text-slate-900 dark:text-slate-100">{Math.round(value)}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <motion.div 
          initial={{ width: 0 }} 
          animate={{ width: `${value}%` }} 
          className={`h-full rounded-full ${color}`} 
        />
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </label>
  );
}

function InfoRow({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700 dark:bg-slate-800/60">
      <p className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">{icon} {title}</p>
      <p className="text-sm text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="mb-2 font-semibold">{title}</p>
      {children}
    </div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="mb-3 block text-sm">
      {label}: <span className="font-semibold">{Math.round(value * 100)}%</span>
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-blue-600" />
    </label>
  );
}

function MapController({ center, zoom, routes }: { center: Coord; zoom: number; routes: RouteData[] }) {
  const map = useMap();
  useEffect(() => {
    if (routes.length > 0) {
      const allWaypoints = routes.flatMap(r => r.waypoints || []);
      if (allWaypoints.length > 0) {
        const bounds = L.latLngBounds(allWaypoints.map(p => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [50, 50] });
      } else {
        map.setView([center.lat, center.lng], zoom);
      }
    } else {
      map.setView([center.lat, center.lng], zoom);
    }
  }, [center, zoom, routes]);
  return null;
}
