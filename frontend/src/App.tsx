import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import axios from "axios";
import { GoogleMap, Marker, Polyline, Circle, useJsApiLoader } from "@react-google-maps/api";
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
  Warehouse,
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
type RouteData = { id: string; label: string; distanceKm: number; durationHours: number; polyline?: string };
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
const mapsLibraries: "places"[] = ["places"];
const defaultOrigin: Coord = { lat: 20.5937, lng: 78.9629 };
const defaultDestination: Coord = { lat: 25.2048, lng: 55.2708 };
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

  const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const { isLoaded } = useJsApiLoader({ id: "kairos-shield-map", googleMapsApiKey: mapsKey || "", libraries: mapsLibraries });

  const selectedAnalysis = analyses[selectedRouteId] || analyses[routes[0]?.id || ""] || null;

  const rankedRoutes = useMemo(() => {
    return routes
      .map((route) => {
        const analysis = analyses[route.id];
        const risk = analysis?.delayProbability || 60;
        const loss = analysis?.cost.totalExpectedLoss || 0;
        const premium = analysis?.insurance.adjustedPremium || 0;
        const score = Math.round(route.durationHours * 0.32 + route.distanceKm * 0.02 + risk * 1.6 + (loss + premium) / 60000);
        return { ...route, score };
      })
      .sort((a, b) => a.score - b.score);
  }, [analyses, routes]);

  const recommendedRoute = rankedRoutes[0];
  const safestRoute = routes
    .map((route) => ({ route, risk: analyses[route.id]?.delayProbability ?? 100 }))
    .sort((a, b) => a.risk - b.risk)[0]?.route;
  const currentRoute = routes.find((r) => r.id === selectedRouteId) || routes[0];
  const showAlternateAdvice =
    Boolean(currentRoute && safestRoute) &&
    currentRoute?.id !== safestRoute?.id &&
    (analyses[currentRoute.id]?.delayProbability ?? 100) > (analyses[safestRoute.id]?.delayProbability ?? 100);

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
    try {
      const routeRes = await api.post("/routes/compute", { origin: form.origin, destination: form.destination });
      const computedRoutes: RouteData[] = routeRes.data.routes || [];
      const orig = routeRes.data.origin || defaultOrigin;
      const dest = routeRes.data.destination || defaultDestination;

      setRouteSource(routeRes.data.source || "estimated");
      setRoutes(computedRoutes);
      setOriginCoord(orig);
      setDestinationCoord(dest);

      const routeAnalyses = await Promise.all(computedRoutes.map((route) => analyzeSingleRoute(route, form, whatIf, orig)));
      const mapped = computedRoutes.reduce<Record<string, Analysis>>((acc, route, idx) => {
        acc[route.id] = routeAnalyses[idx];
        return acc;
      }, {});
      setAnalyses(mapped);
      setSelectedRouteId(computedRoutes[0]?.id || "");
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
      recommendedRoute,
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

  const insuranceCompare = routes.map((route) => ({
    name: route.label,
    premium: analyses[route.id]?.insurance.adjustedPremium || 0,
  }));

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
          {mapsKey && isLoaded ? (
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: "520px" }}
              center={originCoord}
              zoom={mapZoom}
              options={{
                mapTypeControl: false,
                fullscreenControl: false,
                streetViewControl: false,
                zoomControl: false,
                styles: [
                  { featureType: "poi", stylers: [{ visibility: "off" }] },
                  { featureType: "transit", stylers: [{ visibility: "off" }] },
                ],
              }}
            >
              <Marker position={originCoord} label="O" />
              <Marker position={destinationCoord} label="D" />
              {(mapView === "route" || mapView === "risk") &&
                routes.map((route, index) => (
                  <Polyline key={route.id} path={[originCoord, destinationCoord]} options={{ strokeColor: index === 0 ? "#2563eb" : "#10b981", strokeWeight: index === 0 ? 5 : 4, strokeOpacity: 0.85 }} />
                ))}
              {mapView === "risk" &&
                (selectedAnalysis?.riskZones || []).map((zone) => (
                  <Circle key={zone.name} center={{ lat: zone.lat, lng: zone.lng }} radius={zone.radiusKm * 1000} options={{ fillColor: "#ef4444", fillOpacity: 0.12, strokeColor: "#dc2626", strokeWeight: 1 }} />
                ))}
              {mapView === "ports" &&
                (selectedAnalysis?.smartPorts || []).slice(0, 5).map((port, idx) => (
                  <Marker key={port.name} position={{ lat: originCoord.lat + idx * 1.8, lng: originCoord.lng + idx * 2.2 }} label="P" />
                ))}
            </GoogleMap>
          ) : (
            <FallbackMap
              mapView={mapView}
              zoom={mapZoom}
              origin={originCoord}
              destination={destinationCoord}
              riskZones={selectedAnalysis?.riskZones || []}
              ports={selectedAnalysis?.smartPorts || []}
            />
          )}
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Route data source: <span className="font-semibold">{routeSource}</span>
            {selectedAnalysis?.fallbackLabel ? ` • ${selectedAnalysis.fallbackLabel}` : ""}
          </p>
        </section>

        <aside className="col-span-3 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck size={16} /> Intelligence Summary</h2>
          <motion.div layout className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
            <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Delay Risk Score</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{selectedAnalysis?.delayProbability ?? 0}%</p>
            <p className={`text-sm font-semibold ${selectedAnalysis?.classification === "High" ? "text-rose-600" : selectedAnalysis?.classification === "Medium" ? "text-amber-600" : "text-emerald-600"}`}>
              {selectedAnalysis?.classification || "Not analyzed"}
            </p>
          </motion.div>
          <InfoRow icon={<AlertTriangle size={14} />} title="AI Explanation" value={selectedAnalysis?.explanation || "Run analysis"} />
          <InfoRow icon={<MapPin size={14} />} title="Recommended Action" value={selectedAnalysis?.recommendation || "Not available"} />
          <InfoRow icon={<Warehouse size={14} />} title="Warehouse Suggestion" value={selectedAnalysis?.recoveryPlan.nearestWarehouse || "-"} />
          <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
            <p className="font-medium text-slate-900 dark:text-slate-100">Insurance</p>
            <p>Base: ₹{(selectedAnalysis?.insurance.basePremium || 0).toLocaleString()}</p>
            <p>Route: ₹{(selectedAnalysis?.insurance.adjustedPremium || 0).toLocaleString()}</p>
            <p className="font-semibold text-emerald-600">Savings: ₹{Math.max(0, (selectedAnalysis?.insurance.adjustedPremium || 0) - (analyses[recommendedRoute?.id || ""]?.insurance.adjustedPremium || 0)).toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/60">
            <p className="mb-1 font-semibold text-slate-900 dark:text-slate-100">Top Risk Contributors</p>
            {(selectedAnalysis?.contributors || []).slice(0, 4).map((item) => (
              <div key={item.name} className="mb-1 flex items-center justify-between">
                <span>{item.name}</span>
                <span>{item.value}%</span>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/60">
            <p className="mb-1 font-semibold text-slate-900 dark:text-slate-100">Risk Numbers</p>
            {Object.entries(selectedAnalysis?.riskNumbers || {}).map(([key, value]) => (
              <div key={key} className="mb-1 flex items-center justify-between">
                <span className="capitalize">{key}</span>
                <span>{value}%</span>
              </div>
            ))}
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                {showAlternateAdvice && safestRoute && (
                  <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-800">
                    Alternate route recommended: <span className="font-semibold">{safestRoute.label}</span> is safer than the current route.
                  </div>
                )}
                {rankedRoutes.map((route) => (
                  <button key={route.id} onClick={() => setSelectedRouteId(route.id)} className={`mb-2 block w-full rounded-lg border p-3 text-left ${selectedRouteId === route.id ? "border-blue-500 bg-blue-50" : "border-slate-200"}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{route.label}</span>
                      <span className="text-xs">Decision Score: {route.score}</span>
                    </div>
                    <p className="text-xs text-slate-500">{route.distanceKm} km • {route.durationHours} hr</p>
                    <p className="text-xs text-slate-600">
                      Delay risk: {analyses[route.id]?.delayProbability ?? "--"}% • Expected loss: ₹{(analyses[route.id]?.cost.totalExpectedLoss || 0).toLocaleString()}
                    </p>
                  </button>
                ))}
              </div>
              <ChartCard title="Insurance Premium Comparison">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={insuranceCompare}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="premium" fill="#2563eb" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
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

function FallbackMap({
  mapView,
  zoom,
  origin,
  destination,
  riskZones,
  ports,
}: {
  mapView: "route" | "risk" | "ports";
  zoom: number;
  origin: Coord;
  destination: Coord;
  riskZones: Analysis["riskZones"];
  ports: Analysis["smartPorts"];
}) {
  const toX = (lng: number) => ((lng + 180) / 360) * 100;
  const toY = (lat: number) => ((90 - lat) / 180) * 100;
  const scale = 1 + (zoom - 3) * 0.08;
  return (
    <div className="relative h-[520px] overflow-hidden rounded-xl bg-gradient-to-br from-sky-100 via-slate-100 to-emerald-100">
      <svg viewBox="0 0 100 100" className="h-full w-full">
        <g transform={`translate(${50 - 50 * scale} ${50 - 50 * scale}) scale(${scale})`}>
        <rect width="100" height="100" fill="transparent" />
        <path d="M8,22 C26,10 42,16 53,28 C68,44 82,44 96,32 L96,86 L8,86 Z" fill="#dbeafe" />
        <path d="M5,48 C22,35 39,42 56,57 C70,69 86,72 96,62 L96,95 L5,95 Z" fill="#c7d2fe" opacity="0.55" />
        {(mapView === "route" || mapView === "risk") && (
          <>
            <line x1={toX(origin.lng)} y1={toY(origin.lat)} x2={toX(destination.lng)} y2={toY(destination.lat)} stroke="#2563eb" strokeWidth="1.1" strokeDasharray="1.5 1" />
            <line x1={toX(origin.lng)} y1={toY(origin.lat) + 2} x2={toX(destination.lng)} y2={toY(destination.lat) + 1.5} stroke="#10b981" strokeWidth="0.9" strokeDasharray="1 1" />
          </>
        )}
        <circle cx={toX(origin.lng)} cy={toY(origin.lat)} r="1.2" fill="#1d4ed8" />
        <circle cx={toX(destination.lng)} cy={toY(destination.lat)} r="1.2" fill="#0f766e" />
        {mapView === "risk" &&
          riskZones.map((zone) => (
            <circle key={zone.name} cx={toX(zone.lng)} cy={toY(zone.lat)} r={Math.max(2.5, zone.radiusKm / 140)} fill="#ef4444" opacity="0.18" />
          ))}
        {mapView === "ports" &&
          ports.slice(0, 5).map((port, index) => (
            <circle key={port.name} cx={12 + index * 14} cy={20 + index * 10} r="1.1" fill="#0ea5e9" />
          ))}
        </g>
      </svg>
      <div className="absolute left-3 top-3 rounded bg-white/90 px-3 py-2 text-xs text-slate-600">Estimated map view (set `VITE_GOOGLE_MAPS_API_KEY` for live map).</div>
    </div>
  );
}
