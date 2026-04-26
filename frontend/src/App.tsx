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
  cost: { transportCost: number; delayCost: number; storageCost: number; penaltyCost: number; totalExpectedLoss: number };
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

const GATEWAYS = {
  SUEZ: { lat: 29.9, lng: 32.5 },
  BAB_EL_MANDEB: { lat: 12.6, lng: 43.5 },
  MALACCA: { lat: 2.5, lng: 102.5 },
  GIBRALTAR: { lat: 36.1, lng: -5.3 },
  CAPE: { lat: -34.8, lng: 20.0 },
  SOUTH_CHINA_SEA: { lat: 15.0, lng: 115.0 },
  ARABIAN_SEA: { lat: 15.0, lng: 65.0 },
  INDIAN_OCEAN: { lat: -5.0, lng: 80.0 },
  ATLANTIC_SOUTH: { lat: -20.0, lng: -10.0 },
  BISCAY: { lat: 45.0, lng: -10.0 },
};

const getMaritimeWaypoints = (start: Coord, end: Coord, mode: "suez" | "cape" | "transshipment"): Coord[] => {
  const path: Coord[] = [start];
  
  if (start.lng > 40 && end.lng < 30) {
    if (mode === "cape") {
      if (start.lng > 80) path.push(GATEWAYS.MALACCA);
      path.push(GATEWAYS.INDIAN_OCEAN);
      path.push(GATEWAYS.CAPE);
      path.push(GATEWAYS.ATLANTIC_SOUTH);
      path.push(GATEWAYS.BISCAY);
    } else if (mode === "suez") {
      if (start.lng > 80) path.push(GATEWAYS.MALACCA);
      path.push(GATEWAYS.ARABIAN_SEA);
      path.push(GATEWAYS.BAB_EL_MANDEB);
      path.push(GATEWAYS.SUEZ);
      path.push(GATEWAYS.GIBRALTAR);
    } else {
      // Transshipment via Singapore
      path.push(GATEWAYS.MALACCA);
      path.push({ lat: 5.0, lng: 100.0 });
      path.push(GATEWAYS.ARABIAN_SEA);
      path.push(GATEWAYS.BAB_EL_MANDEB);
      path.push(GATEWAYS.SUEZ);
      path.push(GATEWAYS.GIBRALTAR);
    }
  } else if (start.lng > 70 && end.lng > 120) {
    path.push(GATEWAYS.MALACCA);
    path.push(GATEWAYS.SOUTH_CHINA_SEA);
  } else {
    const latOffset = Math.abs(end.lng - start.lng) > 90 ? -15 : -5;
    path.push({ lat: start.lat + (end.lat - start.lat) * 0.33 + latOffset, lng: start.lng + (end.lng - start.lng) * 0.33 });
    path.push({ lat: start.lat + (end.lat - start.lat) * 0.66 + latOffset, lng: start.lng + (end.lng - start.lng) * 0.66 });
  }

  path.push(end);
  return path;
};

export default function App() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem("kairos-theme");
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
      // 1. Geocoding via Nominatim
      const geocode = async (q: string) => {
        const { data } = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`);
        if (data && data.length > 0) {
          return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        }
        return null;
      };

      const orig = await geocode(form.origin);
      const dest = await geocode(form.destination);

      if (!orig || !dest) {
        setGeocodingError(`Could not find ${!orig ? "origin" : "destination"}. Please try a more specific name.`);
        setLoading(false);
        return;
      }

      // 2. Route Computation (Simulated/Backend)
      const routeRes = await api.post("/routes/compute", { origin: form.origin, destination: form.destination });
      const baseRoutes: RouteData[] = routeRes.data.routes || [];
      
      // Expand to 3 decision routes
      const computedRoutes: RouteData[] = [
        { ...baseRoutes[0], id: "suez", label: "Suez Canal Route", durationHours: baseRoutes[0].durationHours, distanceKm: baseRoutes[0].distanceKm },
        { ...baseRoutes[0], id: "cape", label: "Cape of Good Hope", durationHours: baseRoutes[0].durationHours * 1.4, distanceKm: baseRoutes[0].distanceKm * 1.35 },
        { ...baseRoutes[0], id: "trans", label: "Transshipment (Singapore)", durationHours: baseRoutes[0].durationHours * 1.2, distanceKm: baseRoutes[0].distanceKm * 1.15 }
      ];

      setRouteSource(routeRes.data.source || "estimated");

      const routesWithWaypoints = computedRoutes.map((r) => ({
        ...r,
        waypoints: getMaritimeWaypoints(orig, dest, r.id as "suez" | "cape" | "transshipment")
      }));
      
      setRoutes(routesWithWaypoints);
      setOriginCoord(orig);
      setDestinationCoord(dest);

      const routeAnalyses = await Promise.all(computedRoutes.map((route) => analyzeSingleRoute(route, form, whatIf, orig)));
      const mapped = computedRoutes.reduce<Record<string, Analysis>>((acc, route, idx) => {
        // Adjust risk logic for decision engine
        if (route.id === "cape") {
          routeAnalyses[idx].delayProbability = Math.max(5, routeAnalyses[idx].delayProbability - 25);
          routeAnalyses[idx].classification = "Low";
          routeAnalyses[idx].insurance.adjustedPremium *= 0.7;
        } else if (route.id === "suez") {
          routeAnalyses[idx].delayProbability = Math.min(95, routeAnalyses[idx].delayProbability + 20);
          routeAnalyses[idx].classification = "High";
        }
        
        acc[route.id] = routeAnalyses[idx];
        return acc;
      }, {});
      setAnalyses(mapped);
      setSelectedRouteId("cape"); // Default to safer recommended route
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
    anchor.download = "kairos-shield-report.json";
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
        { name: "Transport", value: selectedAnalysis.cost.transportCost },
        { name: "Delay", value: selectedAnalysis.cost.delayCost },
        { name: "Storage", value: selectedAnalysis.cost.storageCost },
        { name: "Penalty", value: selectedAnalysis.cost.penaltyCost },
      ]
    : [];

  useEffect(() => {
    localStorage.setItem("kairos-theme", isDark ? "dark" : "light");
  }, [isDark]);

  return (
    <div className={isDark ? "dark" : ""}>
      <div className="min-h-screen bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white px-5 py-4 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100">Kairos Shield</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">AI-powered supply chain intelligence</p>
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
                    key={route.id} 
                    positions={(route.waypoints || [originCoord, destinationCoord]).map(p => [p.lat, p.lng]) as L.LatLngExpression[]} 
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
              <p className="mt-1 text-lg font-bold">Cape of Good Hope</p>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-bold">₹{(analyses["suez"]?.cost.totalExpectedLoss || 0 - (analyses["cape"]?.cost.totalExpectedLoss || 0)).toLocaleString()}</span>
                <span className="text-xs opacity-80">Estimated Savings</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed opacity-90">
                Recommended due to high volatility in the Red Sea. Savings primarily from significantly lower insurance premiums and zero piracy risk.
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
            <RiskBar label="Geopolitical" value={selectedRouteId === "suez" ? 85 : 12} color="bg-rose-500" />
            <RiskBar label="Weather" value={selectedRouteId === "cape" ? 65 : 30} color="bg-blue-500" />
            <RiskBar label="Port Congestion" value={selectedRouteId === "suez" ? 70 : 40} color="bg-amber-500" />
            <RiskBar label="Insurance Risk" value={selectedAnalysis?.insurance.adjustedRatePct || 0} color="bg-indigo-500" />
          </div>

          <InfoRow icon={<AlertTriangle size={14} />} title="AI Explanation" value={selectedAnalysis?.explanation || "Run analysis"} />
          <InfoRow icon={<MapPin size={14} />} title="Recommended Action" value={selectedAnalysis?.recommendation || "Not available"} />
          <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
            <p className="font-medium text-slate-900 dark:text-slate-100">Financial Impact</p>
            <div className="mt-1 space-y-1 text-xs">
              <div className="flex justify-between"><span>Insurance</span><span>₹{(selectedAnalysis?.insurance.adjustedPremium || 0).toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Delay Loss</span><span>₹{(selectedAnalysis?.cost.delayCost || 0).toLocaleString()}</span></div>
              <div className="flex justify-between font-bold border-t border-slate-100 dark:border-slate-700 pt-1 mt-1 text-rose-600">
                <span>Expected Loss</span><span>₹{(selectedAnalysis?.cost.totalExpectedLoss || 0).toLocaleString()}</span>
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
                  const isRecommended = route.id === "cape";
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
                        <span>Expected Loss:</span><span className="text-right font-medium text-slate-900">₹{(analysis?.cost.totalExpectedLoss || 0).toLocaleString()}</span>
                      </div>
                      <div className="mt-3 flex gap-1">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${route.id === "suez" ? "bg-amber-100 text-amber-700" : route.id === "cape" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
                          {route.id === "suez" ? "Fastest" : route.id === "cape" ? "Safest" : "Balanced"}
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
                      <th className="px-4 py-3">Financial Impact</th>
                      <th className="px-4 py-3">Verdict</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {routes.map(r => {
                      const ana = analyses[r.id];
                      return (
                        <tr key={r.id} className={selectedRouteId === r.id ? "bg-blue-50/20" : ""}>
                          <td className="px-4 py-3 font-semibold">{r.label}</td>
                          <td className={`px-4 py-3 ${r.id === "suez" ? "text-emerald-600 font-bold" : ""}`}>{Math.round(r.durationHours / 24)} days</td>
                          <td className={`px-4 py-3 ${ana?.delayProbability < 30 ? "text-emerald-600 font-bold" : ana?.delayProbability > 70 ? "text-rose-600" : ""}`}>{ana?.delayProbability}%</td>
                          <td className="px-4 py-3">₹{(ana?.insurance.adjustedPremium || 0).toLocaleString()}</td>
                          <td className={`px-4 py-3 font-bold ${r.id === "cape" ? "text-emerald-600" : "text-rose-600"}`}>₹{(ana?.cost.totalExpectedLoss || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 italic opacity-70">
                            {r.id === "suez" ? "Vulnerable to Red Sea delays" : r.id === "cape" ? "Bypasses high-risk zones" : "Transshipment overhead"}
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
              <ChartCard title="Loss Components">
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
                <p className="font-semibold">Financial Impact Summary</p>
                <p>Transport Cost: ₹{(selectedAnalysis?.cost.transportCost || 0).toLocaleString()}</p>
                <p>Delay Cost: ₹{(selectedAnalysis?.cost.delayCost || 0).toLocaleString()}</p>
                <p>Storage Cost: ₹{(selectedAnalysis?.cost.storageCost || 0).toLocaleString()}</p>
                <p>Penalty Cost: ₹{(selectedAnalysis?.cost.penaltyCost || 0).toLocaleString()}</p>
                <p className="mt-2 text-base font-semibold text-rose-600">Total Expected Loss: ₹{(selectedAnalysis?.cost.totalExpectedLoss || 0).toLocaleString()}</p>
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
                <p>Expected Loss: ₹{(selectedAnalysis?.cost.totalExpectedLoss || 0).toLocaleString()}</p>
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
