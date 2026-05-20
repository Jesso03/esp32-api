require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let sensorData = { temperature: null, humidity: null, airQuality: null, timestamp: null };
let relayState = { relay1: false, relay2: false };
let sequence = { active: false, phase: null, timer: null, trigger: null };
const history = [];
const MAX_HISTORY = 200;

const THRESHOLDS = {
  tempExtract: 30,
  tempStop: 27,
  airExtract: 700,
  airStop: 550,
  injectTime: 3 * 60 * 1000,
};

function stopAll() {
  relayState.relay1 = false;
  relayState.relay2 = false;
  if (sequence.timer) clearTimeout(sequence.timer);
  sequence.active = false;
  sequence.phase = null;
  sequence.timer = null;
  sequence.trigger = null;
  console.log("[SEQ] Todo apagado");
}

function startInjecting() {
  relayState.relay2 = false;
  relayState.relay1 = true;
  sequence.phase = "injecting";
  console.log("[SEQ] METIENDO aire por 3 minutos");
  sequence.timer = setTimeout(() => {
    console.log("[SEQ] 3 minutos cumplidos — apagando");
    stopAll();
  }, THRESHOLDS.injectTime);
}

function startExtracting(trigger) {
  if (sequence.active) return;
  relayState.relay2 = true;
  relayState.relay1 = false;
  sequence.active = true;
  sequence.phase = "extracting";
  sequence.trigger = trigger;
  console.log(`[SEQ] SACANDO aire — trigger: ${trigger}`);
}

function evaluateAuto() {
  if (!sensorData.temperature) return;
  const temp = sensorData.temperature;
  const air = sensorData.airQuality;

  if (sequence.phase === "injecting") return;

  if (temp >= THRESHOLDS.tempExtract || air >= THRESHOLDS.airExtract) {
    startExtracting(temp >= THRESHOLDS.tempExtract ? "temperature" : "air");
    return;
  }

  if (sequence.phase === "extracting") {
    const tempOk = temp <= THRESHOLDS.tempStop;
    const airOk = air <= THRESHOLDS.airStop;
    const shouldInject =
      (sequence.trigger === "temperature" && tempOk) ||
      (sequence.trigger === "air" && airOk) ||
      (tempOk && airOk);
    if (shouldInject) startInjecting();
    return;
  }

  if (!sequence.active) {
    relayState.relay1 = false;
    relayState.relay2 = false;
  }
}

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/api/sensors", (req, res) => {
  const { temperature, humidity, airQuality } = req.body;
  if (temperature === undefined || humidity === undefined || airQuality === undefined)
    return res.status(400).json({ error: "Faltan campos" });

  sensorData = {
    temperature: parseFloat(temperature),
    humidity: parseFloat(humidity),
    airQuality: parseFloat(airQuality),
    timestamp: new Date().toISOString(),
  };
  history.push({ ...sensorData });
  if (history.length > MAX_HISTORY) history.shift();
  evaluateAuto();

  res.json({ received: true, relay1: relayState.relay1, relay2: relayState.relay2, phase: sequence.phase });
});

app.get("/api/sensors", (req, res) => res.json(sensorData));
app.get("/api/sensors/history", (req, res) => res.json(history));
app.get("/api/relays", (req, res) => res.json({ ...relayState, phase: sequence.phase, sequenceActive: sequence.active }));

app.put("/api/relays/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const { state } = req.body;
  if (![1, 2].includes(id)) return res.status(400).json({ error: "ID inválido" });
  stopAll();
  relayState[`relay${id}`] = Boolean(state);
  console.log(`[MANUAL] Relay${id} => ${relayState[`relay${id}`]}`);
  res.json({ updated: true, relay: id, state: relayState[`relay${id}`] });
});

app.get("/api/status", (req, res) => res.json({
  sensors: sensorData,
  relays: relayState,
  sequence: { active: sequence.active, phase: sequence.phase, trigger: sequence.trigger },
  thresholds: THRESHOLDS,
  historyCount: history.length,
}));

app.listen(PORT, () => console.log(`✅ ESP32 API corriendo en puerto ${PORT}`));
