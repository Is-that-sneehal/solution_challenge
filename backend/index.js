require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors());
app.use(express.json());

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const WEATHER_API_BASE = "https://api.open-meteo.com/v1/forecast";

const shadowZones = [
  { name: "Strait of Hormuz", lat: 26.57, lng: 56.25, radiusKm: 220, weight: 0.9 },
  { name: "Red Sea Corridor", lat: 18.4, lng: 40.5, radiusKm: 480, weight: 0.8 },
  { name: "South China Sea", lat: 13.8, lng: 114.8, radiusKm: 650, weight: 0.75 },
  { name: "Black Sea", lat: 43.2, lng: 34.8, radiusKm: 380, weight: 0.7 },
  { name: "Suez Canal", lat: 30.5, lng: 32.35, radiusKm: 170, weight: 0.78 },
];

const standardMaritimeCorridors = [
  { id: "north-sea", name: "North Sea Corridor", lat: 56.5, lng: 3.2, radiusKm: 900, baselineRisk: 0.28 },
  { id: "suez", name: "Suez-Med Corridor", lat: 32.5, lng: 26.9, radiusKm: 1100, baselineRisk: 0.46 },
  { id: "hormuz", name: "Hormuz-Arabian Corridor", lat: 24.2, lng: 58.4, radiusKm: 980, baselineRisk: 0.62 },
  { id: "red-sea", name: "Red Sea Corridor", lat: 19.8, lng: 40.6, radiusKm: 1000, baselineRisk: 0.57 },
  { id: "south-china", name: "South China Sea Lane", lat: 12.5, lng: 114.2, radiusKm: 1300, baselineRisk: 0.53 },
  { id: "atlantic", name: "Atlantic Transshipment Lane", lat: 33.5, lng: -35.4, radiusKm: 2100, baselineRisk: 0.34 },
];

const examplePorts = [
  "Mumbai Port",
  "JNPT / Nhava Sheva",
  "Singapore Port",
  "Port of Rotterdam",
  "Jebel Ali Port",
  "Colombo Port",
];

const countryAffinityRisk = {
  US: { sensitive: 0.7, neutral: 0.45, preferred: 0.32 },
  CN: { sensitive: 0.42, neutral: 0.48, preferred: 0.36 },
  IN: { sensitive: 0.52, neutral: 0.47, preferred: 0.35 },
  AE: { sensitive: 0.58, neutral: 0.44, preferred: 0.31 },
};

const cargoConfig = {
  oil: { safety: 1.35, delay: 0.95, baseRate: 0.0115 },
  chemicals: { safety: 1.5, delay: 0.9, baseRate: 0.0125 },
  perishable: { safety: 1.0, delay: 1.42, baseRate: 0.0108 },
  electronics: { safety: 1.12, delay: 1.1, baseRate: 0.0096 },
};

const hashNumber = (value = "") => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h << 5) - h + value.charCodeAt(i);
  return Math.abs(h);
};

const estimateCoord = (text = "", fallbackLat = 0, fallbackLng = 0) => {
  const hash = hashNumber(text || `${fallbackLat}-${fallbackLng}`);
  const lat = ((hash % 14000) / 100) - 70;
  const lng = (((hash / 14000) % 36000) / 100) - 180;
  return { lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) };
};

const haversineKm = (a, b) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return R * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
};

const classifyRisk = (score) => (score < 35 ? "Low" : score < 70 ? "Medium" : "High");

const buildFallbackPredictions = (input) => {
  const q = input.trim();
  if (!q) return examplePorts.map((description) => ({ description, placeId: `fallback-${description}` }));
  const basic = [
    `${q}`,
    `${q} Port`,
    `${q} Harbor`,
    `${q} Logistics Hub`,
    `${q} Free Zone`,
    `${q} Distribution Center`,
  ];
  const merged = [...basic, ...examplePorts.filter((x) => x.toLowerCase().includes(q.toLowerCase()))];
  return [...new Set(merged)].slice(0, 8).map((description) => ({ description, placeId: `fallback-${description}` }));
};

const parseDurationToHours = (durationText = "0s") => Number((Number(durationText.replace("s", "")) / 3600).toFixed(1));

const buildFallbackRoutes = (origin, destination) => {
  const originCoord = estimateCoord(origin, 19.076, 72.8777);
  const destinationCoord = estimateCoord(destination, 1.3521, 103.8198);
  const baseDistance = Math.max(220, haversineKm(originCoord, destinationCoord));
  const primaryDuration = Math.max(8, baseDistance / 42);
  const alternateDistance = baseDistance * 1.14;
  return {
    source: "estimated",
    note: "Estimated fallback because Google Routes API key is missing or unavailable.",
    origin: originCoord,
    destination: destinationCoord,
    routes: [
      { id: "primary-estimated", label: "Primary Route", distanceKm: Math.round(baseDistance), durationHours: Number(primaryDuration.toFixed(1)), polyline: "" },
      { id: "alternate-estimated", label: "Alternate Route", distanceKm: Math.round(alternateDistance), durationHours: Number((primaryDuration * 1.21).toFixed(1)), polyline: "" },
    ],
  };
};

const fetchWeatherSeverity = async (lat, lng) => {
  try {
    const { data } = await axios.get(WEATHER_API_BASE, {
      params: { latitude: lat, longitude: lng, current: "wind_speed_10m,precipitation" },
      timeout: 7000,
    });
    const wind = Number(data?.current?.wind_speed_10m || 5);
    const rain = Number(data?.current?.precipitation || 0);
    return { source: "live", value: Number(Math.min(1, wind / 55 + rain / 18).toFixed(2)) };
  } catch {
    return { source: "estimated", value: 0.45 };
  }
};

const getCountryRisk = (carrierCountry, geoRisk) => {
  const countryRule = countryAffinityRisk[(carrierCountry || "IN").toUpperCase()] || { sensitive: 0.55, neutral: 0.48, preferred: 0.35 };
  if (geoRisk > 0.68) return countryRule.sensitive;
  if (geoRisk < 0.35) return countryRule.preferred;
  return countryRule.neutral;
};

const insuranceFor = ({ shipmentValue, riskScore, cargoType, weatherRisk, geoRisk, shadowRisk, congestion }) => {
  const cargo = cargoConfig[cargoType] || cargoConfig.electronics;
  const dynamicRiskRate = (riskScore / 100) * 0.016 + weatherRisk * 0.002 + geoRisk * 0.0022 + shadowRisk * 0.0018 + congestion * 0.0015;
  const adjustedRate = cargo.baseRate + dynamicRiskRate;
  return {
    basePremium: Math.round(shipmentValue * cargo.baseRate),
    adjustedPremium: Math.round(shipmentValue * adjustedRate),
    adjustedRatePct: Number((adjustedRate * 100).toFixed(2)),
  };
};

const buildPortBenchmark = (origin, destination, shipSize, geoRisk) => {
  const dynamicNames = [origin, destination, ...examplePorts].filter(Boolean).slice(0, 8);
  return dynamicNames.map((name) => {
    const h = hashNumber(name);
    const congestion = 0.28 + (h % 42) / 100;
    const capacity = 0.55 + ((h / 7) % 40) / 100;
    const risk = Math.min(0.92, 0.22 + ((h / 11) % 45) / 100 + geoRisk * 0.15);
    const shipCompat = shipSize === "large" ? capacity > 0.7 : shipSize === "medium" ? capacity > 0.62 : true;
    const score = Math.round((1 - congestion) * 35 + capacity * 38 + (1 - risk) * 27 + (shipCompat ? 6 : -8));
    return {
      name,
      congestion: Number(congestion.toFixed(2)),
      capacity: Number(capacity.toFixed(2)),
      risk: Number(risk.toFixed(2)),
      shipCompatible: shipCompat,
      waitHours: Math.round(4 + congestion * 30),
      score,
    };
  }).sort((a, b) => b.score - a.score);
};

const riskEngine = ({
  route,
  shipment,
  whatIf,
  weatherRisk,
}) => {
  const cargo = cargoConfig[shipment.cargoType] || cargoConfig.electronics;
  const distanceRisk = Math.min(1, route.distanceKm / 13000);
  const durationRisk = Math.min(1, route.durationHours / 220);
  const countryRisk = getCountryRisk(shipment.carrierCountry, whatIf.geopolitical);
  const sizeRisk = shipment.shipSize === "large" ? 0.58 : shipment.shipSize === "medium" ? 0.46 : 0.34;
  const capacityMismatch = shipment.shipSize === "large" ? 0.18 : 0.12;

  const weighted =
    weatherRisk * 0.15 * cargo.delay +
    whatIf.congestion * 0.16 +
    whatIf.geopolitical * 0.18 * cargo.safety +
    whatIf.shadowFleet * 0.13 * cargo.safety +
    distanceRisk * 0.1 +
    durationRisk * 0.08 * cargo.delay +
    countryRisk * 0.1 +
    sizeRisk * 0.06 +
    capacityMismatch * 0.04;

  const delayProbability = Math.round(Math.min(0.96, weighted) * 100);
  const classification = classifyRisk(delayProbability);

  const contributors = [
    { name: "Geopolitical Tension", value: Math.round(whatIf.geopolitical * 100) },
    { name: "Port Congestion", value: Math.round(whatIf.congestion * 100) },
    { name: "Shadow Fleet", value: Math.round(whatIf.shadowFleet * 100) },
    { name: "Weather", value: Math.round(weatherRisk * 100) },
    { name: "Country Affinity", value: Math.round(countryRisk * 100) },
  ].sort((a, b) => b.value - a.value);

  const recommendation =
    classification === "High"
      ? "Switch to lower-risk alternate route and compliant ports. Increase monitoring near shadow-fleet corridors."
      : classification === "Medium"
      ? "Maintain primary route with congestion buffers and pre-booked warehousing."
      : "Proceed with primary route and standard risk controls.";

  return {
    delayProbability,
    classification,
    contributors,
    recommendation,
    countryRisk: Number(countryRisk.toFixed(2)),
    components: {
      weather: Number((weatherRisk * 100).toFixed(1)),
      congestion: Number((whatIf.congestion * 100).toFixed(1)),
      geopolitical: Number((whatIf.geopolitical * 100).toFixed(1)),
      shadowFleet: Number((whatIf.shadowFleet * 100).toFixed(1)),
      countryAffinity: Number((countryRisk * 100).toFixed(1)),
      distance: Number((distanceRisk * 100).toFixed(1)),
      duration: Number((durationRisk * 100).toFixed(1)),
      shipSize: Number((sizeRisk * 100).toFixed(1)),
      capacityMismatch: Number((capacityMismatch * 100).toFixed(1)),
    },
  };
};

const nearestCorridors = (origin, destination) => {
  const midpoint = {
    lat: (Number(origin.lat || 0) + Number(destination.lat || 0)) / 2,
    lng: (Number(origin.lng || 0) + Number(destination.lng || 0)) / 2,
  };
  return standardMaritimeCorridors
    .map((corridor) => {
      const d = haversineKm(midpoint, { lat: corridor.lat, lng: corridor.lng });
      const proximity = Math.max(0, 1 - d / corridor.radiusKm);
      const used = d <= corridor.radiusKm * 1.4;
      return {
        ...corridor,
        distanceFromRouteKm: Math.round(d),
        proximityScore: Number((proximity * 100).toFixed(1)),
        used,
      };
    })
    .sort((a, b) => a.distanceFromRouteKm - b.distanceFromRouteKm);
};

const financials = ({ shipmentValue, delayProbability, route, cargoType }) => {
  const cargo = cargoConfig[cargoType] || cargoConfig.electronics;
  const transport = route.distanceKm * 1.9;
  const delay = route.durationHours * 70 * cargo.delay * (delayProbability / 100);
  const storage = route.durationHours * 11.5;
  const penalty = shipmentValue * (delayProbability / 100) * 0.055;
  return {
    transportCost: Math.round(transport),
    delayCost: Math.round(delay),
    storageCost: Math.round(storage),
    penaltyCost: Math.round(penalty),
    totalExpectedLoss: Math.round(transport + delay + storage + penalty),
  };
};

app.get("/api/health", (_, res) => res.json({ status: "ok", service: "Kairos Shield API" }));

app.get("/api/places/autocomplete", async (req, res) => {
  const input = String(req.query.input || "");
  if (!GOOGLE_MAPS_API_KEY) return res.json({ source: "estimated", predictions: buildFallbackPredictions(input) });

  try {
    const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/autocomplete/json", {
      params: { input, key: GOOGLE_MAPS_API_KEY, types: "geocode|establishment" },
      timeout: 8000,
    });
    const predictions = (data.predictions || []).slice(0, 8);
    return res.json({ source: "live", predictions: predictions.length ? predictions : buildFallbackPredictions(input) });
  } catch {
    return res.json({ source: "estimated", predictions: buildFallbackPredictions(input) });
  }
});

app.post("/api/routes/compute", async (req, res) => {
  const { origin, destination } = req.body || {};
  if (!origin || !destination) return res.status(400).json({ error: "origin and destination are required" });

  if (!GOOGLE_MAPS_API_KEY) return res.json(buildFallbackRoutes(origin, destination));

  try {
    const payload = {
      origin: { address: origin },
      destination: { address: destination },
      travelMode: "DRIVE",
      computeAlternativeRoutes: true,
      routingPreference: "TRAFFIC_AWARE",
      polylineQuality: "OVERVIEW",
      languageCode: "en-US",
    };
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,geocodingResults",
    };
    const { data } = await axios.post("https://routes.googleapis.com/directions/v2:computeRoutes", payload, { headers, timeout: 10000 });
    const routes = (data.routes || []).slice(0, 2).map((r, index) => ({
      id: index === 0 ? "primary-live" : "alternate-live",
      label: index === 0 ? "Primary Route" : "Alternate Route",
      distanceKm: Math.round((r.distanceMeters || 0) / 1000),
      durationHours: parseDurationToHours(r.duration || "0s"),
      polyline: r.polyline?.encodedPolyline || "",
    }));
    if (!routes.length) return res.json(buildFallbackRoutes(origin, destination));
    return res.json({
      source: "live",
      origin: data.geocodingResults?.origin?.geometry?.location || estimateCoord(origin),
      destination: data.geocodingResults?.destination?.geometry?.location || estimateCoord(destination),
      routes,
    });
  } catch {
    return res.json(buildFallbackRoutes(origin, destination));
  }
});

app.post("/api/intelligence/analyze", async (req, res) => {
  const { shipment = {}, route = {}, whatIf = {}, coordinates = {} } = req.body || {};
  const normalizedWhatIf = {
    weather: Number(whatIf.weather ?? 0.45),
    congestion: Number(whatIf.congestion ?? 0.52),
    geopolitical: Number(whatIf.geopolitical ?? 0.48),
    shadowFleet: Number(whatIf.shadowFleet ?? 0.44),
  };

  const weather = await fetchWeatherSeverity(Number(coordinates.lat || 20.59), Number(coordinates.lng || 78.96));
  const weatherRisk = normalizedWhatIf.weather ?? weather.value;

  const shipmentValue = Number(shipment.shipmentValue || 1000000);
  const model = riskEngine({
    route: { distanceKm: Number(route.distanceKm || 1200), durationHours: Number(route.durationHours || 36) },
    shipment: {
      cargoType: shipment.cargoType || "electronics",
      carrierCountry: shipment.carrierCountry || "IN",
      shipSize: shipment.shipSize || "medium",
    },
    whatIf: normalizedWhatIf,
    weatherRisk,
  });

  const cost = financials({
    shipmentValue,
    delayProbability: model.delayProbability,
    route: { distanceKm: Number(route.distanceKm || 1200), durationHours: Number(route.durationHours || 36) },
    cargoType: shipment.cargoType || "electronics",
  });

  const insurance = insuranceFor({
    shipmentValue,
    riskScore: model.delayProbability,
    cargoType: shipment.cargoType || "electronics",
    weatherRisk,
    geoRisk: normalizedWhatIf.geopolitical,
    shadowRisk: normalizedWhatIf.shadowFleet,
    congestion: normalizedWhatIf.congestion,
  });

  const ports = buildPortBenchmark(shipment.origin, shipment.destination, shipment.shipSize || "medium", normalizedWhatIf.geopolitical);
  const topPort = ports[0];

  res.json({
    source: weather.source === "live" ? "live+estimated" : "estimated",
    fallbackLabel: weather.source === "live" ? "" : "Estimated values are shown where live APIs are unavailable.",
    delayProbability: model.delayProbability,
    classification: model.classification,
    contributors: model.contributors,
    recommendation: model.recommendation,
    explanation: `${model.classification} disruption profile. Dominant factors are ${model.contributors
      .slice(0, 2)
      .map((x) => x.name.toLowerCase())
      .join(" and ")}.`,
    insurance,
    cost,
    smartPorts: ports,
    riskNumbers: model.components,
    standardRoutes: nearestCorridors(
      { lat: Number(coordinates.lat || 20.59), lng: Number(coordinates.lng || 78.96) },
      estimateCoord(String(shipment.destination || "destination"))
    ),
    recoveryPlan: {
      nearestWarehouse: `${shipment.destination || "Destination"} Logistics Hub`,
      alternateModes: ["Rail-first inland transfer", "Road feeder via low-congestion node", "Sea diversion through compliant transshipment hub"],
      potentialDelayReductionHours: Math.round(6 + normalizedWhatIf.congestion * 18),
      potentialSavings: Math.round((insurance.adjustedPremium - insurance.basePremium) * 0.45 + cost.totalExpectedLoss * 0.12),
      suggestedPort: topPort?.name || "Best available port",
    },
    riskZones: shadowZones,
    cloudReady: {
      firestoreCollection: "shipment_analyses",
      bigQueryTable: "kairos_shield.risk_events",
      vertexAiPlaceholder: "projects/.../locations/.../publishers/google/models/gemini-2.0-flash",
      geminiPromptTemplate: "Explain route risk and mitigation in concise business language.",
    },
  });
});

app.listen(PORT, () => {
  console.log(`Kairos Shield backend listening on port ${PORT}`);
});
