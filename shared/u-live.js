/* ============================================================================
   uispace — live-data adapters (public, key-less APIs only)
   Sources selected from the Public APIs index (data/refernce/public-apis).
   Each adapter normalizes the response and degrades to a deterministic SIM feed.
   ========================================================================== */
(function (g) {
  'use strict';
  const U = g.U;
  const api = U.api = {};
  const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

  /* ------------------------------------------------------------ SIM helpers */
  const sim = U.sim = {};
  sim.series = function (n, opts = {}) {
    const r = U.rnd(opts.seed || 42); const out = [];
    let v = opts.start ?? 50;
    for (let i = 0; i < n; i++) {
      v += (r() - .5) * (opts.vol ?? 8) + (opts.trend || 0);
      v = U.clamp(v, opts.min ?? 0, opts.max ?? 100);
      out.push(round(v, opts.dec ?? 1));
    }
    return out;
  };
  sim.walk = function (n, start = 100, vol = 1.2, seed = 7, dec = 2) {
    const r = U.rnd(seed); let v = start; const out = [];
    for (let i = 0; i < n; i++) { v *= 1 + (r() - .5) * vol / 100; out.push({ t: i, v: round(v, dec) }); }
    return out;
  };
  sim.osc = function (n, a = 1, off = 0, seed = 3) {
    const r = U.rnd(seed); return Array.from({ length: n }, (_, i) => round(off + Math.sin(i * .5 + r()) * a + (r() - .5) * a * .3, 2));
  };

  /* ------------------------------------------------------------ Open-Meteo */
  api.openMeteo = function (lat = 51.5, lon = -0.12) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
      '&hourly=temperature_2m,precipitation_probability,wind_speed_10m&forecast_days=2&timezone=UTC';
    return U.live({
      source: 'Open-Meteo', url,
      parse: (j) => ({
        temp: j.current.temperature_2m, feels: j.current.apparent_temperature,
        humidity: j.current.relative_humidity_2m, pressure: j.current.pressure_msl,
        wind: j.current.wind_speed_10m, gust: j.current.wind_gusts_10m,
        dir: j.current.wind_direction_10m, rain: j.current.precipitation,
        cloud: j.current.cloud_cover, code: j.current.weather_code,
        hourlyT: j.hourly.temperature_2m.slice(0, 24),
        hourlyP: j.hourly.precipitation_probability.slice(0, 24),
        hourlyW: j.hourly.wind_speed_10m.slice(0, 24)
      }),
      fallback: () => ({
        temp: 14.2, feels: 12.8, humidity: 71, pressure: 1008.4, wind: 22.4, gust: 38.1,
        dir: 212, rain: 0.4, cloud: 64, code: 61,
        hourlyT: sim.series(24, { start: 12, vol: 1.6, seed: 3 }),
        hourlyP: sim.series(24, { start: 40, vol: 12, seed: 9, max: 100 }),
        hourlyW: sim.series(24, { start: 20, vol: 5, seed: 5, max: 90 })
      })
    });
  };

  api.marine = function (lat = 54.2, lon = -4.5) {
    const url = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lon +
      '&current=wave_height,wave_direction,wave_period,swell_wave_height&hourly=wave_height,wave_period&forecast_days=2&timezone=UTC';
    return U.live({
      source: 'Open-Meteo Marine', url,
      parse: (j) => ({ wave: j.current.wave_height, dir: j.current.wave_direction, period: j.current.wave_period, swell: j.current.swell_wave_height, series: j.hourly.wave_height.slice(0, 24) }),
      fallback: () => ({ wave: 1.8, dir: 248, period: 7.4, swell: 1.2, series: sim.series(24, { start: 1.6, vol: .3, seed: 12, min: .4 }) })
    });
  };

  api.airQuality = function (lat = 51.5, lon = -0.12) {
    const url = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + lat + '&longitude=' + lon +
      '&current=pm10,pm2_5,nitrogen_dioxide,ozone,european_aqi&timezone=UTC';
    return U.live({
      source: 'Open-Meteo Air', url,
      parse: (j) => ({ pm10: j.current.pm10, pm25: j.current.pm2_5, no2: j.current.nitrogen_dioxide, o3: j.current.ozone, aqi: j.current.european_aqi }),
      fallback: () => ({ pm10: 21, pm25: 11, no2: 18, o3: 44, aqi: 38 })
    });
  };

  /* ------------------------------------------------------------ USGS */
  api.quakes = function (minMag = 2.5) {
    const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/' +
      (minMag >= 4.5 ? '4.5_day' : minMag >= 2.5 ? '2.5_day' : 'all_day') + '.geojson';
    return U.live({
      source: 'USGS', url,
      parse: (j) => j.features.slice(0, 60).map((f) => ({
        mag: f.properties.mag, place: f.properties.place,
        time: new Date(f.properties.time), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
        depth: f.geometry.coordinates[2]
      })),
      fallback: () => Array.from({ length: 28 }, (_, i) => {
        const r = U.rnd(100 + i);
        return { mag: round(2.5 + r() * 3.4, 1), place: 'SIM region ' + (1 + i % 9), time: new Date(Date.now() - i * 9e5), lon: r() * 360 - 180, lat: r() * 140 - 70, depth: round(r() * 60, 1) };
      })
    });
  };

  /* ------------------------------------------------------------ NASA EONET */
  api.eonet = function () {
    const url = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30';
    return U.live({
      source: 'NASA EONET', url,
      parse: (j) => j.events.map((e) => ({
        id: e.id, title: e.title, category: (e.categories[0] || {}).title || 'Event',
        date: e.geometry && e.geometry.length ? e.geometry[e.geometry.length - 1].date : '',
        lon: e.geometry && e.geometry.length ? e.geometry[e.geometry.length - 1].coordinates[0] : 0,
        lat: e.geometry && e.geometry.length ? e.geometry[e.geometry.length - 1].coordinates[1] : 0
      })),
      fallback: () => [
        { id: 'E1', title: 'Wildfire complex — sim', category: 'Wildfires', date: new Date().toISOString(), lon: -120.4, lat: 39.1 },
        { id: 'E2', title: 'Tropical storm — sim', category: 'Severe Storms', date: new Date().toISOString(), lon: 132.2, lat: 18.4 },
        { id: 'E3', title: 'Volcanic activity — sim', category: 'Volcanoes', date: new Date().toISOString(), lon: 14.4, lat: 40.8 }
      ]
    });
  };

  /* ------------------------------------------------------------ NOAA SWPC (space weather)
     The old solar-wind/plasma-*.json products now 404; Kp, the speed summary and
     the GOES X-ray feed are the endpoints that still answer with CORS enabled. */
  api.solarActivity = async function () {
    const K = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
    const S = 'https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json';
    const X = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
    const get = async (u) => { try { return await U.fetchJSON(u); } catch (e) { return null; } };
    const [k, s, x] = await Promise.all([get(K), get(S), get(X)]);

    const fb = { kp: 3.3, wind: 413, cls: 'C1.2', flux: 1.2e-6, level: 'QUIET', at: null };
    if (!k && !s && !x) return { data: fb, state: 'degraded', source: 'NOAA SWPC' };

    const kp = Array.isArray(k) && k.length ? Number(k[k.length - 1].Kp) : null;
    const wind = Array.isArray(s) && s.length ? Number(s[0].proton_speed) : null;
    let flux = null;
    if (Array.isArray(x)) {
      const band = x.filter((r) => r && r.energy === '0.1-0.8nm');
      const last = band[band.length - 1];
      if (last) flux = Number(last.flux);
    }
    const cls = flux ? xrayClass(flux) : '—';
    const level = kp == null ? '—' : kp >= 5 ? 'STORM' : kp >= 4 ? 'ACTIVE' : 'QUIET';
    return {
      data: { kp: kp == null ? fb.kp : kp, wind: wind == null ? fb.wind : wind, cls, flux, level },
      state: 'live', source: 'NOAA SWPC'
    };
  };

  function xrayClass(f) {
    const scale = [[1e-4, 'X'], [1e-5, 'M'], [1e-6, 'C'], [1e-7, 'B']];
    for (const [t, l] of scale) if (f >= t) return l + (f / t).toFixed(1);
    return 'A' + (f / 1e-8).toFixed(1);
  }

  /* ------------------------------------------------------------ NASA Image Library (keyless) */
  api.nasaImage = function (q = 'mars surface') {
    const url = 'https://images-api.nasa.gov/search?q=' + encodeURIComponent(q) + '&media_type=image&page_size=100';
    return U.live({
      source: 'NASA Image Library', url,
      parse: (j) => {
        const items = (j.collection.items || []).filter((it) => it.links && it.links[0] && it.data && it.data[0]);
        if (!items.length) throw new Error('no imagery');
        const day = Math.floor(Date.now() / 864e5);
        const it = items[day % items.length];
        const m = it.data[0];
        return {
          url: (it.links[0].href || '').replace(/^http:/, 'https:'),
          title: m.title || 'MARS',
          date: (m.date_created || '').slice(0, 10),
          center: m.center || 'NASA',
          id: m.nasa_id || '',
          href: m.nasa_id ? 'https://images.nasa.gov/details-' + m.nasa_id : 'https://images.nasa.gov'
        };
      },
      fallback: () => ({ url: '', title: 'NO DOWNLINK', date: '', center: 'NASA', id: '', href: 'https://images.nasa.gov' })
    });
  };

  /* ------------------------------------------------------------ JPL Horizons (baked snapshot)
     Horizons has no CORS headers, so shared/mars-ephemeris.js carries a daily
     table of Mars heliocentric range generated by specs/_tests/bake-mars.mjs. */
  api.marsEph = function (date) {
    const E = g.UISPACE_MARS_EPH;
    const fb = { dist: 1.524, irr: 586 };
    if (!E || !E.r || !E.r.length) return { data: fb, state: 'degraded', source: 'JPL Horizons' };
    const [Y, M, D] = E.start.split('-').map(Number);
    const t0 = Date.UTC(Y, M - 1, D);
    const idx = Math.round(((date || Date.now()) - t0) / 864e5);
    if (idx < 0 || idx >= E.r.length) return { data: fb, state: 'degraded', source: 'JPL Horizons' };
    const dist = E.r[idx];
    return {
      data: { dist, irr: 1361 / (dist * dist) },
      state: 'snapshot',
      source: 'JPL Horizons'
    };
  };

  /* ------------------------------------------------------------ OpenSky (aircraft) */
  api.aircraft = function (bbox) {
    const b = bbox || ''; // 'lamin,lomin,lamax,lomax'
    const url = 'https://opensky-network.org/api/states/all' + (b ? '?lamin=' + b.split(',')[0] + '&lomin=' + b.split(',')[1] + '&lamax=' + b.split(',')[2] + '&lomax=' + b.split(',')[3] : '');
    return U.live({
      source: 'OpenSky Network', url, opts: { timeout: 9000 },
      parse: (j) => (j.states || []).slice(0, 120).map((s) => ({
        icao: s[0], callsign: (s[1] || '').trim(), lon: s[5], lat: s[6], alt: s[7] || 0,
        velocity: s[9] || 0, heading: s[10] || 0, onGround: s[8]
      })),
      fallback: () => Array.from({ length: 42 }, (_, i) => {
        const r = U.rnd(700 + i);
        return { icao: 'SIM' + U.pad(i, 3), callsign: 'SIM' + (100 + i), lon: -10 + r() * 40, lat: 35 + r() * 25, alt: 2000 + r() * 10000, velocity: 180 + r() * 220, heading: r() * 360, onGround: false };
      })
    });
  };

  /* ------------------------------------------------------------ CoinGecko + FX */
  api.crypto = function (ids = ['bitcoin', 'ethereum', 'solana', 'monero']) {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + ids.join(',') + '&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true';
    return U.live({
      source: 'CoinGecko', url,
      parse: (j) => ids.map((id) => ({ id, price: j[id] ? j[id].usd : 0, chg: j[id] ? j[id].usd_24h_change : 0, vol: j[id] ? j[id].usd_24h_vol : 0 })),
      fallback: () => ids.map((id, i) => ({ id, price: [67240, 3240, 148, 162][i % 4] * (1 + (U.rnd(i + 1)() - .5) * .05), chg: (U.rnd(i + 3)() - .5) * 9, vol: 1.2e9 }))
    });
  };

  api.fx = function (base = 'USD') {
    const url = 'https://api.frankfurter.app/latest?from=' + base;
    return U.live({
      source: 'Frankfurter (ECB)', url,
      parse: (j) => Object.entries(j.rates).map(([k, v]) => ({ pair: base + '/' + k, rate: v })),
      fallback: () => [['EUR', .921], ['GBP', .789], ['JPY', 151.2], ['CHF', .882], ['CAD', 1.36], ['AUD', 1.52]].map(([k, v]) => ({ pair: base + '/' + k, rate: v }))
    });
  };

  /* ------------------------------------------------------------ Hacker News */
  api.hackernews = async function (limit = 8) {
    try {
      const ids = await U.fetchJSON('https://hacker-news.firebaseio.com/v0/topstories.json');
      const items = await Promise.all(ids.slice(0, limit).map((id) => U.fetchJSON('https://hacker-news.firebaseio.com/v0/item/' + id + '.json')));
      return { state: 'live', source: 'Hacker News', data: items.filter(Boolean).map((i) => ({ id: i.id, title: i.title, score: i.score, by: i.by, time: new Date(i.time * 1000) })) };
    } catch (e) {
      const r = U.rnd(31);
      return { state: 'degraded', source: 'Hacker News', data: Array.from({ length: limit }, (_, i) => ({ id: i, title: ['Signal routing across a fractured mesh', 'Notes on deterministic UI systems', 'A field guide to instrument panels', 'Latency budgets for ambient dashboards', 'Reconstructing a 1970s control room'][i % 5], score: 40 + Math.floor(r() * 400), by: 'sim_' + i, time: new Date() })) };
    }
  };

  /* ------------------------------------------------------------ ISS position */
  api.iss = function () {
    const url = 'https://api.wheretheiss.at/v1/satellites/25544';
    return U.live({
      source: 'WhereTheISS', url,
      parse: (j) => ({ lat: j.latitude, lon: j.longitude, alt: j.altitude, vel: j.velocity, vis: j.visibility }),
      fallback: () => ({ lat: 21.4, lon: -54.2, alt: 420.1, vel: 27561, vis: 'daylight' })
    });
  };

  /* ------------------------------------------------------------ NASA InSight (Mars surface weather)
     The lander's archive is the only public, CORS-open record of real Mars
     surface temperature, pressure and wind. It is a reference feed, not a
     live forecast, so callers should label it with the sol it came from.
     DEMO_KEY is shared and capped at ~30 requests/hour; a personal key can be
     supplied with api.insight('KEY'), ?nasa=KEY or localStorage 'uisp:nasa:key'. */
  api.insight = function (key) {
    if (!key) {
      try {
        key = new URLSearchParams(location.search).get('nasa') ||
          localStorage.getItem('uisp:nasa:key') || 'DEMO_KEY';
      } catch (e) { key = 'DEMO_KEY'; }
    }
    const url = 'https://api.nasa.gov/insight_weather/?api_key=' + encodeURIComponent(key) + '&feedtype=json&ver=1.0';
    return U.live({
      source: 'NASA InSight', url,
      parse: (j) => {
        const sols = (j.sol_keys || []).filter((k) => j[k] && j[k].AT);
        if (!sols.length) throw new Error('no sol telemetry');
        const sol = sols[sols.length - 1], d = j[sol];
        const at = d.AT || {}, pre = d.PRE || {}, hws = d.HWS || {};
        const wd = (d.WD && d.WD.most_common) || null;
        return {
          sol: +sol,
          temp: { av: round(at.av, 1), mn: round(at.mn, 1), mx: round(at.mx, 1) },
          pressure: { av: round(pre.av, 0), mn: round(pre.mn, 0), mx: round(pre.mx, 0) },
          wind: { av: round(hws.av, 1), mx: round(hws.mx, 1) },
          dir: wd ? wd.compass_point : '—',
          dirDeg: wd ? wd.compass_degrees : null,
          season: d.Season || '—',
          northSeason: d.Northern_season || '—',
          first: d.First_UTC || null,
          last: d.Last_UTC || null
        };
      },
      fallback: () => ({
        sol: 681,
        temp: { av: -62.4, mn: -95.4, mx: -4.4 },
        pressure: { av: 744, mn: 718, mx: 760 },
        wind: { av: 5.6, mx: 18.6 },
        dir: 'WNW', dirDeg: 292.5, season: 'fall', northSeason: 'mid winter',
        first: '2020-10-25T22:29:51Z', last: '2020-10-26T23:09:26Z'
      })
    });
  };

  /* ------------------------------------------------------------ World Time */
  api.timezone = function (tz = 'Etc/UTC') {
    const url = 'https://worldtimeapi.org/api/timezone/' + tz;
    return U.live({
      source: 'WorldTimeAPI', url,
      parse: (j) => ({ utc: j.utc_datetime, offset: j.utc_offset, tz: j.timezone, day: j.day_of_year }),
      fallback: () => ({ utc: new Date().toISOString(), offset: '+00:00', tz, day: 1 })
    });
  };

  /* ------------------------------------------------------------ sunrise / daylight */
  api.sun = function (lat = 51.5, lon = -0.12) {
    const url = 'https://api.sunrise-sunset.org/json?lat=' + lat + '&lng=' + lon + '&formatted=0';
    return U.live({
      source: 'Sunrise-Sunset', url,
      parse: (j) => ({ sunrise: j.results.sunrise, sunset: j.results.sunset, day: j.results.day_length, noon: j.results.solar_noon }),
      fallback: () => ({ sunrise: new Date(Date.now() - 6e6).toISOString(), sunset: new Date(Date.now() + 6e6).toISOString(), day: 32400, noon: new Date().toISOString() })
    });
  };
})(window);
