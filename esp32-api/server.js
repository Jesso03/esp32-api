require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Estado en memoria (última lectura recibida del ESP32) ─────────────────────
let sensorData = {
  temperature: null,   // °C  — DHT22
  humidity: null,      // %   — DHT22
  airQuality: null,    // ppm — MQ135
  timestamp: null,
};

let relayState = {
  relay1: false,  // extractor 1
  relay2: false,  // extractor 2
};

// Historial (últimas 100 lecturas)
const history = [];
const MAX_HISTORY = 100;

// ─── Umbrales automáticos (configurables vía API) ──────────────────────────────
let thresholds = {
  tempMax: 35,        // °C  — activa relay1
  humidityMax: 80,    // %   — activa relay2
  airQualityMax: 400, // ppm — activa ambos relés
};

// ─── Helpers ───────────────────────────────────────────────────────────────────
function applyAutoControl() {
  if (sensorData.temperature === null) return;

  const prevR1 = relayState.relay1;
  const prevR2 = relayState.relay2;

  // Lógica automática basada en umbrales
  if (sensorData.airQuality > thresholds.airQualityMax) {
    relayState.relay1 = true;
    relayState.relay2 = true;
  } else {
    if (sensorData.temperature > thresholds.tempMax) {
      relayState.relay1 = true;
    } else {
      relayState.relay1 = false;
    }

    if (sensorData.humidity > thresholds.humidityMax) {
      relayState.relay2 = true;
    } else {
      relayState.relay2 = false;
    }
  }

  if (prevR1 !== relayState.relay1 || prevR2 !== relayState.relay2) {
    console.log(
      `[AUTO] Relay1=${relayState.relay1} Relay2=${relayState.relay2}`
    );
  }
}

// ─── RUTAS ────────────────────────────────────────────────────────────────────

// GET /  →  health check (útil para Render keep-alive)
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "ESP32 Sensor API running 🚀" });
});

// ── SENSORES ──────────────────────────────────────────────────────────────────

/**
 * POST /api/sensors
 * El ESP32 envía sus lecturas aquí.
 * Body: { "temperature": 28.5, "humidity": 65.2, "airQuality": 320 }
 */
app.post("/api/sensors", (req, res) => {
  const { temperature, humidity, airQuality } = req.body;

  if (temperature === undefined || humidity === undefined || airQuality === undefined) {
    return res.status(400).json({ error: "Faltan campos: temperature, humidity, airQuality" });
  }

  sensorData = {
    temperature: parseFloat(temperature),
    humidity: parseFloat(humidity),
    airQuality: parseFloat(airQuality),
    timestamp: new Date().toISOString(),
  };

  // Guardar en historial
  history.push({ ...sensorData });
  if (history.length > MAX_HISTORY) history.shift();

  // Aplicar control automático
  applyAutoControl();

  // Responder al ESP32 con el estado actual de los relés
  res.json({
    received: true,
    relay1: relayState.relay1,
    relay2: relayState.relay2,
  });
});

/**
 * GET /api/sensors
 * Obtiene la última lectura de sensores.
 */
app.get("/api/sensors", (req, res) => {
  res.json(sensorData);
});

/**
 * GET /api/sensors/history
 * Devuelve el historial de lecturas (últimas 100).
 */
app.get("/api/sensors/history", (req, res) => {
  res.json(history);
});

// ── RELÉS ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/relays
 * El ESP32 consulta el estado de los relés (polling).
 */
app.get("/api/relays", (req, res) => {
  res.json(relayState);
});

/**
 * POST /api/relays
 * Dashboard o cliente externo cambia el estado manualmente.
 * Body: { "relay1": true, "relay2": false }
 */
app.post("/api/relays", (req, res) => {
  const { relay1, relay2 } = req.body;

  if (relay1 !== undefined) relayState.relay1 = Boolean(relay1);
  if (relay2 !== undefined) relayState.relay2 = Boolean(relay2);

  console.log(`[MANUAL] Relay1=${relayState.relay1} Relay2=${relayState.relay2}`);
  res.json({ updated: true, ...relayState });
});

/**
 * PUT /api/relays/:id
 * Controla un relé individual.
 * :id = 1 o 2
 * Body: { "state": true }
 */
app.put("/api/relays/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const { state } = req.body;

  if (![1, 2].includes(id)) {
    return res.status(400).json({ error: "ID de relé inválido. Usa 1 o 2." });
  }
  if (state === undefined) {
    return res.status(400).json({ error: "Campo 'state' requerido (true/false)" });
  }

  relayState[`relay${id}`] = Boolean(state);
  console.log(`[RELAY${id}] => ${relayState[`relay${id}`]}`);

  res.json({ updated: true, relay: id, state: relayState[`relay${id}`] });
});

// ── UMBRALES ──────────────────────────────────────────────────────────────────

/**
 * GET /api/thresholds
 * Obtiene los umbrales actuales de control automático.
 */
app.get("/api/thresholds", (req, res) => {
  res.json(thresholds);
});

/**
 * POST /api/thresholds
 * Actualiza umbrales de control automático.
 * Body: { "tempMax": 30, "humidityMax": 75, "airQualityMax": 350 }
 */
app.post("/api/thresholds", (req, res) => {
  const { tempMax, humidityMax, airQualityMax } = req.body;

  if (tempMax !== undefined) thresholds.tempMax = parseFloat(tempMax);
  if (humidityMax !== undefined) thresholds.humidityMax = parseFloat(humidityMax);
  if (airQualityMax !== undefined) thresholds.airQualityMax = parseFloat(airQualityMax);

  res.json({ updated: true, thresholds });
});

// ── ESTADO COMPLETO ───────────────────────────────────────────────────────────

/**
 * GET /api/status
 * Estado completo del sistema (sensores + relés + umbrales).
 */
app.get("/api/status", (req, res) => {
  res.json({
    sensors: sensorData,
    relays: relayState,
    thresholds,
    historyCount: history.length,
  });
});

// ─── Inicio ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ ESP32 API corriendo en puerto ${PORT}`);
});
