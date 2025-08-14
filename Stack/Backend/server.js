// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import maxmind from "maxmind";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve frontend
app.use(express.static(path.join(__dirname, "../FrontEnd")));

// --- GeoIP (optional) ---
let cityLookup = null;
try {
  // If you have GeoLite2-City.mmdb in project root, this will load it.
  // If you don't want to use MaxMind, comment out this block and look at fallback below.
  (async () => {
    cityLookup = await maxmind.open(path.join(__dirname, "GeoLite2-City.mmdb"));
    console.log("✅ GeoLite2 database loaded");
  })();
} catch (e) {
  console.warn(
    "⚠️ Could not load GeoLite2 automatically — falling back to random coords"
  );
  cityLookup = null;
}

// --- Attack tracking and dedupe ---
const tracked = new Map(); // ip -> { count, lat, lon, city, country, timer }
const COOLDOWN_MS = 30 * 1000; // 30 seconds cooldown per IP (changeable)

let totalAttacks = 0;

// helpers
function randomCoord() {
  const lat = Math.random() * 170 - 85;
  const lon = Math.random() * 360 - 180;
  return { lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)) };
}

function geoForIp(ip) {
  if (cityLookup) {
    const geo = cityLookup.get(ip);
    if (geo && geo.location && typeof geo.location.latitude === "number") {
      return {
        lat: geo.location.latitude,
        lon: geo.location.longitude,
        city: geo.city?.names?.en || "Unknown",
        country: geo.country?.names?.en || "Unknown",
      };
    }
  }
  // fallback: random coords and Unknown labels
  const rc = randomCoord();
  return { lat: rc.lat, lon: rc.lon, city: "Unknown", country: "Unknown" };
}

// handle an observed attack IP
function observeAttack(ip) {
  totalAttacks++;
  io.emit("total", { totalAttacks });

  const now = Date.now();
  const existing = tracked.get(ip);

  if (existing) {
    // increment count and refresh cooldown timer
    existing.count += 1;
    existing.lastSeen = now;

    // reset removal timer
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => removeIp(ip), COOLDOWN_MS);

    // notify frontend to update counter in-place
    io.emit("updateCount", {
      ip,
      count: existing.count,
      city: existing.city,
      country: existing.country,
      lat: existing.lat,
      lon: existing.lon,
      lastSeen: existing.lastSeen,
    });

    console.log(
      `🔁 ${ip} seen again — count=${existing.count} (${existing.city}, ${existing.country})`
    );
    return;
  }

  // new IP seen: build geo and add
  const geo = geoForIp(ip);
  const entry = {
    ip,
    count: 1,
    lat: geo.lat,
    lon: geo.lon,
    city: geo.city,
    country: geo.country,
    firstSeen: now,
    lastSeen: now,
    timer: null,
  };

  // set a timer to remove from tracked list after cooldown
  entry.timer = setTimeout(() => removeIp(ip), COOLDOWN_MS);

  tracked.set(ip, entry);

  // emit new attack event
  io.emit("attack", {
    ip: entry.ip,
    count: entry.count,
    lat: entry.lat,
    lon: entry.lon,
    city: entry.city,
    country: entry.country,
    firstSeen: entry.firstSeen,
  });

  console.log(`🚨 Attack from ${entry.city}, ${entry.country} (${entry.ip})`);
}

// remove ip after cooldown and notify frontend
function removeIp(ip) {
  const entry = tracked.get(ip);
  if (!entry) return;
  clearTimeout(entry.timer);
  tracked.delete(ip);
  io.emit("remove", { ip });
  console.log(`🗑️ Removed ${ip} from active list (cooldown expired)`);
}

// --- Simulation (replace with real ingestion) ---
// You can replace this simulateAttack() with your real feed handler that calls observeAttack(ip)
const exampleIPs = [
  "62.210.18.40",
  "210.48.22.134",
  "81.2.69.142",
  "186.33.216.1",
  "204.126.41.119",
  "144.22.238.11",
  "123.24.18.221",
  "99.122.159.34",
];

function simulateAttack() {
  const ip = exampleIPs[Math.floor(Math.random() * exampleIPs.length)];
  observeAttack(ip);
}

// simulate every 2s
setInterval(simulateAttack, 2000);

// --- Socket.IO: on client connect, send current tracked list & total ---
io.on("connection", (socket) => {
  console.log("🟢 Client connected");
  // send current total
  socket.emit("total", { totalAttacks });

  // send current tracked entries so UI can hydrate
  const arr = [...tracked.values()].map((e) => ({
    ip: e.ip,
    count: e.count,
    lat: e.lat,
    lon: e.lon,
    city: e.city,
    country: e.country,
    firstSeen: e.firstSeen,
    lastSeen: e.lastSeen,
  }));
  socket.emit("hydrate", { tracked: arr });

  socket.on("disconnect", () => console.log("🔴 Client disconnected"));
});

// start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
