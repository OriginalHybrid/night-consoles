import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const AIRPORTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/flight-tracking/airports.json'), 'utf8'));
const OUT = path.join(ROOT, 'shared/data/flight-tracking/flights.json');

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x464C49474854);
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
const round = (v, d = 4) => Number(v.toFixed(d));
const toRad = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;

const AIRLINES = [
  ['BAW', 'British Airways'], ['DLH', 'Lufthansa'], ['AFR', 'Air France'],
  ['KLM', 'KLM'], ['UAE', 'Emirates'], ['QTR', 'Qatar Airways'],
  ['SIA', 'Singapore Airlines'], ['UAL', 'United Airlines'], ['DAL', 'Delta Air Lines'],
  ['AAL', 'American Airlines'], ['SWA', 'Southwest Airlines'], ['JAL', 'Japan Airlines'],
  ['ANA', 'All Nippon Airways'], ['QFA', 'Qantas'], ['CPA', 'Cathay Pacific'],
  ['THY', 'Turkish Airlines'], ['IBE', 'Iberia'], ['ITA', 'ITA Airways'],
  ['ACA', 'Air Canada'], ['LAN', 'LATAM'], ['ETH', 'Ethiopian Airlines'],
  ['SAA', 'South African Airways'], ['GARUDA', 'Garuda Indonesia'], ['MAS', 'Malaysia Airlines']
];
const TYPES = ['A320', 'A321', 'A333', 'A339', 'A350', 'A388', 'B738', 'B739', 'B752', 'B763', 'B77W', 'B788', 'B789', 'B78X', 'E190', 'CRJ9'];

function greatCircle(a, b, f) {
  const p1 = toRad(a.lat), l1 = toRad(a.lon), p2 = toRad(b.lat), l2 = toRad(b.lon);
  const dp = p2 - p1, dl = l2 - l1;
  const d = 2 * Math.asin(Math.sqrt(Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2));
  if (d < 1e-8) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return { lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: toDeg(Math.atan2(y, x)) };
}
function bearing(a, b) {
  const p1 = toRad(a.lat), p2 = toRad(b.lat), dl = toRad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const flights = [];
for (let i = 0; i < 110; i++) {
  const origin = pick(AIRPORTS);
  let destination = pick(AIRPORTS);
  while (destination.iata === origin.iata) destination = pick(AIRPORTS);
  const [code, airline] = pick(AIRLINES);
  const ground = rnd() < 0.07;
  const progress = ground ? (rnd() < 0.5 ? 0.015 + rnd() * 0.03 : 0.955 + rnd() * 0.03) : 0.04 + rnd() * 0.92;
  const pos = greatCircle(origin, destination, progress);
  const altitude = ground ? 0 : Math.round(800 + rnd() * 39000);
  const speed = ground ? Math.round(5 + rnd() * 24) : Math.round(380 + rnd() * 150);
  const vertical = ground ? 0 : Math.round((rnd() - 0.45) * 2200);
  const squawk = i === 19 ? '7700' : i === 53 ? '7600' : String(1000 + Math.floor(rnd() * 6000)).padStart(4, '0');
  flights.push({
    icao24: Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0'),
    callsign: code + (100 + Math.floor(rnd() * 899)),
    airline,
    registration: 'N' + (100 + Math.floor(rnd() * 899)) + 'NC',
    type: pick(TYPES),
    origin: origin.iata,
    destination: destination.iata,
    lat: round(pos.lat),
    lon: round(pos.lon),
    altitude,
    speed,
    track: round(bearing(origin, destination), 1),
    verticalRate: vertical,
    onGround: ground,
    squawk,
    progress: round(progress, 3),
    status: ground ? 'GROUND' : vertical > 400 ? 'CLIMB' : vertical < -400 ? 'DESCENT' : 'AIRBORNE',
    live: false
  });
}

const regions = [
  { id: 'london', name: 'LONDON / EUROPE', lat: 51.47, lon: -0.45, radius: 100, zoom: 4.8 },
  { id: 'new-york', name: 'NEW YORK / EAST COAST', lat: 40.64, lon: -73.78, radius: 100, zoom: 4.8 },
  { id: 'los-angeles', name: 'LOS ANGELES / WEST COAST', lat: 33.94, lon: -118.40, radius: 100, zoom: 4.8 },
  { id: 'tokyo', name: 'TOKYO / JAPAN', lat: 35.55, lon: 139.78, radius: 100, zoom: 4.8 },
  { id: 'singapore', name: 'SINGAPORE / SE ASIA', lat: 1.36, lon: 103.99, radius: 100, zoom: 4.8 },
  { id: 'dubai', name: 'DUBAI / GULF', lat: 25.25, lon: 55.36, radius: 100, zoom: 4.8 },
  { id: 'delhi', name: 'DELHI / NORTH INDIA', lat: 28.56, lon: 77.10, radius: 100, zoom: 4.8 },
  { id: 'sydney', name: 'SYDNEY / AUSTRALIA', lat: -33.94, lon: 151.18, radius: 100, zoom: 4.8 },
  { id: 'global', name: 'GLOBAL / SIMULATED', lat: 18, lon: 8, radius: 0, zoom: 1 }
];

const out = {
  generatedAt: new Date().toISOString(),
  defaultRegion: 'london',
  regions,
  flights
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('wrote ' + OUT + ' (' + flights.length + ' flights, ' + regions.length + ' regions)');
