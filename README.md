# Kairos Shield

Kairos Shield is a full-stack supply-chain intelligence platform that combines live routing/location APIs with AI-style disruption analytics to reduce delays, optimize routes, and minimize insurance and financial loss.

## Stack

- Frontend: React + Vite + Tailwind + Framer Motion + Recharts + Google Maps JS API
- Backend: Node.js + Express
- APIs: Google Routes API, Google Places Autocomplete API, Open-Meteo weather API
- Cloud-ready placeholders: Firestore schema key, Vertex AI model path, Gemini key slot, BigQuery table key

## Project Structure

- `frontend` - dashboard UI with map, inputs, and analytics panels
- `backend` - APIs for route compute, place suggestions, and risk/loss/insurance analysis
- `.env.example` - required environment variables

## Setup

1. Install dependencies:
   - `npm install`
   - `npm install --prefix backend`
   - `npm install --prefix frontend`
2. Copy env:
   - `copy .env.example .env` (Windows)
3. Set keys in `.env`:
   - `VITE_GOOGLE_MAPS_API_KEY` for frontend map rendering
   - `GOOGLE_MAPS_API_KEY` for backend Places + Routes
   - `GEMINI_API_KEY` placeholder (explainability model future integration)
   - `FIREBASE_CONFIG` placeholder (Firebase Hosting/Firestore integration)
4. Run dev servers:
   - `npm run dev`

## Real-Time vs Mock Behavior

- **Live mode**:
  - Places suggestions from Google Places API
  - Route distance/duration alternatives from Google Routes API
  - Weather severity from Open-Meteo
- **Mock fallback mode**:
  - Triggered automatically if `GOOGLE_MAPS_API_KEY` is missing/unavailable
  - Keeps the same API shape so production keys can be plugged in with no frontend code changes
  - Simulated only for geo-risk, shadow fleet, port congestion, insurance modeling

## Core Features Implemented

- Global shipment planner with working autocomplete for any typed location/port
- Interactive logistics map with route/risk/ports view controls
- Real-time route recomputation and alternate route comparison
- Dynamic risk engine with cargo sensitivity, country affinity, and shadow-fleet zones
- Fully working tabs: route comparison, port selection, financial impact, recovery plan, what-if simulation
- Insurance premium and expected-loss estimation for each route
- Export report as JSON via dashboard action
- Visual analytics charts (risk, financial, and premium comparison)

## Cloud-Ready Notes

The backend response includes `cloudReady` placeholders for:
- Firestore collection: `shipment_analyses`
- Vertex AI model path placeholder
- BigQuery logging table placeholder

These are designed so managed-cloud integrations can be added without breaking existing frontend contracts.
