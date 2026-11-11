// The state plane conversion (public/js/engine/crs.js) against outside references: proj4 (a dev dependency, never
// loaded by the page or the Worker) on a grid across every California zone, and fixed values from PROJ's own EPSG
// database; round trips; and the zone chosen for a site, by county, near the lines between zones.
//
// Published control values: none are asserted. No NGS-published California worked example is known here with enough
// confidence to quote, so the independent references are proj4 (the grid) and PROJ 9.8.1 with its EPSG database
// (pyproj 3.8.0, run on 11 Nov 2026; the twelve points in PROJ_POINTS). The zone points come from the Census Bureau's
// TIGER/Line 2024 county polygons (each county's inside point, and points 150 m either side of the lines between zones).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import * as crs from '../../public/js/engine/crs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The zone definitions exactly as PROJ's EPSG database writes them (pyproj CRS.from_epsg(...).to_proj4()), and NAD83
// latitude and longitude (EPSG 4269) as the source: crs.js treats latitude and longitude as NAD83.
const DEFS = {
  2225: '+proj=lcc +lat_0=39.3333333333333 +lon_0=-122 +lat_1=41.6666666666667 +lat_2=40 +x_0=2000000.0001016 +y_0=500000.0001016 +datum=NAD83 +units=us-ft +no_defs',
  2226: '+proj=lcc +lat_0=37.6666666666667 +lon_0=-122 +lat_1=39.8333333333333 +lat_2=38.3333333333333 +x_0=2000000.0001016 +y_0=500000.0001016 +datum=NAD83 +units=us-ft +no_defs',
  2227: '+proj=lcc +lat_0=36.5 +lon_0=-120.5 +lat_1=38.4333333333333 +lat_2=37.0666666666667 +x_0=2000000.0001016 +y_0=500000.0001016 +datum=NAD83 +units=us-ft +no_defs',
  2228: '+proj=lcc +lat_0=35.3333333333333 +lon_0=-119 +lat_1=37.25 +lat_2=36 +x_0=2000000.0001016 +y_0=500000.0001016 +datum=NAD83 +units=us-ft +no_defs',
  2229: '+proj=lcc +lat_0=33.5 +lon_0=-118 +lat_1=35.4666666666667 +lat_2=34.0333333333333 +x_0=2000000.0001016 +y_0=500000.0001016 +datum=NAD83 +units=us-ft +no_defs',
  2230: '+proj=lcc +lat_0=32.1666666666667 +lon_0=-116.25 +lat_1=33.8833333333333 +lat_2=32.7833333333333 +x_0=2000000.0001016 +y_0=500000.0001016 +datum=NAD83 +units=us-ft +no_defs',
};
const GEO = '+proj=longlat +datum=NAD83 +no_defs';
const conv = Object.fromEntries(Object.entries(DEFS).map(([e, d]) => [e, proj4(GEO, d)]));
// [latitude of origin, central meridian, northern standard parallel] of each zone, to lay the grid out.
const SPAN = { 2225: [39.333, -122, 41.667], 2226: [37.667, -122, 39.833], 2227: [36.5, -120.5, 38.433], 2228: [35.333, -119, 37.25], 2229: [33.5, -118, 35.467], 2230: [32.167, -116.25, 33.883] };

/** 11 x 11 points over each zone: from 0.7 degree south of its origin to 0.7 north of its northern parallel, and 4.5
 * degrees either side of its central meridian (wider than the counties in it). */
function grid(epsg) {
  const [la0, lo0, la1] = SPAN[epsg];
  const out = [];
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) out.push([la0 - 0.7 + (i / 10) * (la1 - la0 + 1.4), lo0 - 4.5 + (j / 10) * 9]);
  return out;
}

// PROJ 9.8.1 (EPSG database), NAD83 to each zone: [epsg, lat, lon, x, y] in degrees and US survey feet.
const PROJ_POINTS = [
  [2225, 41.0, -123.5, 6147678.5241, 2251119.5083], [2225, 39.9, -120.4, 7010567.7257, 1850955.64],
  [2226, 39.2, -122.9, 6306627.6282, 2200105.6896], [2226, 38.0, -120.3, 7051561.5117, 1766400.8878],
  [2227, 37.9, -122.3, 6042335.5744, 2155167.149], [2227, 37.4, -119.2, 6939279.086, 1970737.8113],
  [2228, 36.6, -121.8, 5739877.5431, 2113521.5736], [2228, 35.9, -117.6, 6976319.4991, 1849734.3413],
  [2229, 34.4, -119.7, 6048880.7845, 1972286.0516], [2229, 35.1, -116.0, 7159864.5503, 2228656.6242],
  [2230, 32.7, -117.16, 6281715.6166, 1835694.5082], [2230, 33.7, -114.7, 7033085.9636, 2201836.5928],
];

const COUNTY_POINTS = [
  ['Alameda', 37.64714, -121.91249, 2227], ['Alpine', 38.62178, -119.79835, 2226], ['Amador', 38.44355, -120.65386, 2226], ['Butte', 39.66534, -121.60321, 2226],
  ['Calaveras', 38.19107, -120.55411, 2227], ['Colusa', 39.17774, -122.23756, 2226], ['Contra Costa', 37.91948, -121.95154, 2227], ['Del Norte', 41.7499, -123.981, 2225],
  ['El Dorado', 38.78561, -120.53422, 2226], ['Fresno', 36.76101, -119.65502, 2228], ['Glenn', 39.60255, -122.4017, 2226], ['Humboldt', 40.70666, -123.92618, 2225],
  ['Imperial', 33.04081, -115.3554, 2230], ['Inyo', 36.56216, -117.40421, 2228], ['Kern', 35.34663, -118.72951, 2229], ['Kings', 36.07248, -119.81553, 2228],
  ['Lake', 39.10801, -122.74522, 2226], ['Lassen', 40.71529, -120.62122, 2225], ['Los Angeles', 34.1964, -118.26186, 2229], ['Madera', 37.20982, -119.7498, 2227],
  ['Marin', 38.05137, -122.7464, 2227], ['Mariposa', 37.57434, -119.91172, 2227], ['Mendocino', 39.43239, -123.44288, 2226], ['Merced', 37.19481, -120.7228, 2227],
  ['Modoc', 41.59292, -120.71837, 2225], ['Mono', 37.91584, -118.87517, 2227], ['Monterey', 36.2401, -121.31558, 2228], ['Napa', 38.5071, -122.3259, 2226],
  ['Nevada', 39.29751, -120.77134, 2226], ['Orange', 33.67569, -117.77721, 2230], ['Placer', 39.06203, -120.72272, 2226], ['Plumas', 39.9923, -120.82437, 2225],
  ['Riverside', 33.72983, -116.00224, 2230], ['Sacramento', 38.45014, -121.34433, 2226], ['San Benito', 36.61165, -121.08581, 2228], ['San Bernardino', 34.85666, -116.18157, 2229],
  ['San Diego', 33.0236, -116.77612, 2230], ['San Francisco', 37.72724, -123.03223, 2227], ['San Joaquin', 37.93498, -121.27224, 2227], ['San Luis Obispo', 35.38819, -120.4489, 2229],
  ['San Mateo', 37.41467, -122.37155, 2227], ['Santa Barbara', 34.53668, -120.03836, 2229], ['Santa Clara', 37.22161, -121.68954, 2227], ['Santa Cruz', 37.01235, -122.00779, 2227],
  ['Shasta', 40.76051, -122.04356, 2225], ['Sierra', 39.57693, -120.52199, 2226], ['Siskiyou', 41.58799, -122.53329, 2225], ['Solano', 38.26723, -121.93959, 2226],
  ['Sonoma', 38.52518, -122.92611, 2226], ['Stanislaus', 37.56232, -121.00283, 2227], ['Sutter', 39.03619, -121.70394, 2226], ['Tehama', 40.12616, -122.23227, 2225],
  ['Trinity', 40.64786, -123.11467, 2225], ['Tulare', 36.22883, -118.78106, 2228], ['Tuolumne', 38.02143, -119.96473, 2227], ['Ventura', 34.35875, -119.13315, 2229],
  ['Yolo', 38.67961, -121.90275, 2226], ['Yuba', 39.27013, -121.34426, 2226],
];
const NEAR_LINE = [
  [39.67047, -120.95836, 2225], [39.6929, -120.70115, 2225], [39.70798, -120.51082, 2225], [39.72715, -121.21088, 2225], [39.80102, -122.47864, 2225], [39.80107, -122.4287, 2225],
  [39.81832, -122.94443, 2225], [39.83809, -122.9499, 2225], [39.83973, -122.95446, 2225], [39.84683, -122.95706, 2225], [39.87028, -122.9496, 2225], [39.8864, -122.94823, 2225],
  [39.90796, -122.94212, 2225], [40.00277, -124.02235, 2225], [40.00304, -123.89188, 2225], [38.0617, -122.03626, 2226], [38.06252, -122.22585, 2226], [38.08111, -121.68325, 2226],
  [38.18031, -122.63392, 2226], [38.18076, -122.63586, 2226], [38.18178, -122.63887, 2226], [38.19085, -122.6747, 2226], [38.22299, -120.89608, 2226], [38.24944, -121.25435, 2226],
  [38.25662, -121.44791, 2226], [38.25709, -121.43975, 2226], [38.29011, -122.85973, 2226], [38.3186, -122.9654, 2226], [38.35064, -119.63379, 2226], [38.41226, -119.69889, 2226],
  [38.49746, -120.14555, 2226], [38.49906, -120.11431, 2226], [38.64606, -119.61762, 2226], [38.65244, -119.61587, 2226], [38.65394, -119.61541, 2226], [39.70735, -120.10896, 2226],
  [39.71719, -120.75759, 2226], [39.79813, -122.52541, 2226], [39.82132, -122.05704, 2226], [39.85445, -122.95672, 2226], [39.86451, -122.95397, 2226], [39.88221, -122.03916, 2226],
  [39.91296, -122.93361, 2226], [39.932, -122.91612, 2226], [39.9404, -122.92239, 2226], [39.97571, -123.46359, 2226], [36.80089, -120.37289, 2227], [36.80215, -120.16451, 2227],
  [36.82609, -120.40268, 2227], [36.84132, -120.42113, 2227], [36.86583, -119.80819, 2227], [36.88927, -121.76613, 2227], [36.89469, -120.46299, 2227], [36.89569, -121.76152, 2227],
  [36.91025, -121.74126, 2227], [36.92631, -120.69141, 2227], [36.92878, -121.53949, 2227], [36.93845, -121.52429, 2227], [36.94946, -121.51317, 2227], [36.96294, -121.51027, 2227],
  [36.9707, -120.592, 2227], [37.12061, -119.46777, 2227], [37.17393, -119.36222, 2227], [37.17875, -119.3623, 2227], [37.20764, -119.33175, 2227], [38.05561, -121.86653, 2227],
  [38.19704, -122.70495, 2227], [38.23058, -121.38235, 2227], [38.23428, -121.41634, 2227], [38.2453, -121.23309, 2227], [38.24976, -121.271, 2227], [38.27654, -121.12274, 2227],
  [38.28172, -121.10212, 2227], [38.28803, -121.07909, 2227], [38.29117, -121.05183, 2227], [38.31517, -122.91745, 2227], [38.33443, -119.65266, 2227], [38.45249, -120.0551, 2227],
  [38.47037, -120.41458, 2227], [38.63795, -119.61345, 2227], [35.79128, -119.60843, 2228], [35.79224, -119.11499, 2228], [35.79303, -118.40134, 2228], [35.79339, -120.8756, 2228],
  [35.79575, -116.40174, 2228], [35.79651, -117.25248, 2228], [35.79673, -117.34241, 2228], [36.76811, -120.25592, 2228], [36.7743, -120.99341, 2228], [36.78407, -120.32452, 2228],
  [36.81374, -120.82583, 2228], [36.83285, -119.98987, 2228], [36.84719, -119.8244, 2228], [36.8533, -119.88656, 2228], [36.85515, -121.15054, 2228], [36.88254, -121.77154, 2228],
  [36.8828, -121.77099, 2228], [36.88324, -121.7703, 2228], [36.88905, -121.17865, 2228], [36.89571, -121.56991, 2228], [36.89596, -119.78795, 2228], [36.90149, -120.71751, 2228],
  [36.90512, -121.65466, 2228], [36.9116, -121.55462, 2228], [36.91887, -121.22536, 2228], [36.9246, -120.68875, 2228], [36.94955, -121.5102, 2228], [36.96475, -119.73972, 2228],
  [37.01767, -119.65573, 2228], [37.0646, -119.58746, 2228], [37.06869, -119.55996, 2228], [37.08874, -119.556, 2228], [37.19932, -119.33609, 2228], [37.2801, -119.32965, 2228],
  [37.28305, -119.32891, 2228], [37.46127, -118.1692, 2228], [37.46184, -118.00496, 2228], [37.47966, -118.84105, 2228], [37.54832, -118.93134, 2228], [37.56375, -118.94835, 2228],
  [37.58114, -119.01692, 2228], [33.84537, -118.06054, 2229], [33.90427, -117.98381, 2229], [33.94758, -117.94327, 2229], [34.02085, -117.3171, 2229], [34.03556, -116.74656, 2229],
  [34.03592, -115.98864, 2229], [34.03681, -115.67956, 2229], [34.03681, -115.69298, 2229], [34.03687, -115.58811, 2229], [34.06124, -115.31762, 2229], [34.08122, -114.50633, 2229],
  [34.08128, -115.09001, 2229], [35.78709, -120.12831, 2229], [35.7884, -118.63864, 2229], [35.7888, -118.21882, 2229], [35.78899, -119.21197, 2229], [35.79211, -115.99442, 2229],
  [35.79342, -121.30434, 2229], [35.79379, -117.39048, 2229], [35.79434, -117.44846, 2229], [33.81397, -118.07124, 2230], [33.94445, -117.8824, 2230], [33.96845, -117.60948, 2230],
  [34.01785, -117.36477, 2230], [34.03296, -115.9964, 2230], [34.07784, -114.75172, 2230], [34.07798, -114.63749, 2230], [34.07824, -114.86289, 2230], [34.07829, -114.49137, 2230],
];

test('forward: every zone within 0.001 ft of proj4 over the grid', (t) => {
  let worst = 0, where = null;
  for (const epsg of Object.keys(DEFS).map(Number)) {
    for (const [lat, lon] of grid(epsg)) {
      const [px, py] = conv[epsg].forward([lon, lat]);
      const { x, y } = crs.fromLatLon(epsg, lat, lon);
      const d = Math.max(Math.abs(x - px), Math.abs(y - py));
      if (d > worst) { worst = d; where = { epsg, lat, lon }; }
      assert.ok(d < 0.001, `EPSG ${epsg} at ${lat}, ${lon}: ${x}, ${y} against proj4 ${px}, ${py}`);
    }
  }
  t.diagnostic(`largest forward difference from proj4: ${worst.toExponential(2)} ft (EPSG ${where.epsg} at ${where.lat.toFixed(3)}, ${where.lon.toFixed(3)})`);
});

test('inverse: every zone within 1e-9 degree of proj4 over the grid', (t) => {
  let worst = 0;
  for (const epsg of Object.keys(DEFS).map(Number)) {
    for (const [lat, lon] of grid(epsg)) {
      const [px, py] = conv[epsg].forward([lon, lat]);
      const [plon, plat] = conv[epsg].inverse([px, py]);
      const g = crs.toLatLon(epsg, px, py);
      const d = Math.max(Math.abs(g.lat - plat), Math.abs(g.lon - plon));
      worst = Math.max(worst, d);
      assert.ok(d < 1e-9, `EPSG ${epsg} at ${px}, ${py}: ${g.lat}, ${g.lon} against proj4 ${plat}, ${plon}`);
    }
  }
  t.diagnostic(`largest inverse difference from proj4: ${worst.toExponential(2)} degree`);
});

test('the twelve points worked out by PROJ from the EPSG database agree to 0.001 ft', () => {
  for (const [epsg, lat, lon, x, y] of PROJ_POINTS) {
    const p = crs.fromLatLon(epsg, lat, lon);
    assert.ok(Math.abs(p.x - x) < 0.001 && Math.abs(p.y - y) < 0.001, `EPSG ${epsg} at ${lat}, ${lon}: ${p.x}, ${p.y} against ${x}, ${y}`);
    const g = crs.toLatLon(epsg, x, y);
    assert.ok(Math.abs(g.lat - lat) < 1e-9 && Math.abs(g.lon - lon) < 1e-9, `EPSG ${epsg} back to ${g.lat}, ${g.lon}`);
  }
});

test('round trips: there and back to 1e-11 degree and 1e-6 ft', () => {
  for (const epsg of Object.keys(DEFS).map(Number)) {
    for (const [lat, lon] of grid(epsg)) {
      const p = crs.fromLatLon(epsg, lat, lon);
      const g = crs.toLatLon(epsg, p.x, p.y);
      assert.ok(Math.abs(g.lat - lat) < 1e-11 && Math.abs(g.lon - lon) < 1e-11, `EPSG ${epsg} ${lat}, ${lon} came back ${g.lat}, ${g.lon}`);
      const q = crs.fromLatLon(epsg, g.lat, g.lon);
      assert.ok(Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6);
    }
  }
});

test('the false origin and the central meridian sit where the zone says', () => {
  // On the central meridian at the latitude of origin: exactly the false easting and northing.
  for (const [epsg, [la0, lo0]] of Object.entries({ 2225: [39 + 1 / 3, -122], 2226: [37 + 2 / 3, -122], 2227: [36.5, -120.5], 2228: [35 + 1 / 3, -119], 2229: [33.5, -118], 2230: [32 + 1 / 6, -116.25] })) {
    const p = crs.fromLatLon(Number(epsg), la0, lo0);
    assert.ok(Math.abs(p.x - 6561666.667) < 1e-6 && Math.abs(p.y - 1640416.667) < 1e-6, `${epsg}: ${p.x}, ${p.y}`);
  }
});

test('the zone of a site follows its county: every county, both sides of each zone line, and the islands', () => {
  for (const [name, lat, lon, epsg] of COUNTY_POINTS) assert.equal(crs.zoneFor(lat, lon), epsg, name);
  for (const [lat, lon, epsg] of NEAR_LINE) assert.equal(crs.zoneFor(lat, lon), epsg, `${lat}, ${lon} (150 m from a zone line)`);
  const places = [
    ['Davis', 38.5449, -121.7405, 2226], ['Galt', 38.2546, -121.2999, 2226], ['Lodi', 38.1302, -121.2724, 2227],
    ['Avalon, Santa Catalina Island', 33.343, -118.327, 2229], ['San Clemente Island', 32.9, -118.5, 2229],
    ['San Nicolas Island', 33.25, -119.5, 2229], ['Long Beach', 33.77, -118.19, 2229], ['Huntington Beach', 33.66, -117.99, 2230],
    ['Oceanside', 33.2, -117.38, 2230], ['Point Loma', 32.67, -117.24, 2230], ['Redding', 40.58, -122.39, 2225],
    ['San Francisco', 37.77, -122.42, 2227], ['Southeast Farallon Island', 37.698, -123.003, 2227], ['Bishop', 37.36, -118.4, 2228],
    ['Bakersfield', 35.37, -119.02, 2229], ['El Centro', 32.79, -115.56, 2230], ['Needles', 34.85, -114.61, 2229], ['Blythe', 33.61, -114.6, 2230],
  ];
  for (const [name, lat, lon, epsg] of places) assert.equal(crs.zoneFor(lat, lon), epsg, name);
});

test('bad input is refused in plain words', () => {
  assert.throws(() => crs.fromLatLon(2227.5, 38, -121), /not a California state plane zone/);
  assert.throws(() => crs.toLatLon(4326, 6e6, 2e6), /not a California state plane zone/);
  assert.throws(() => crs.fromLatLon(2226, NaN, -121), /latitude and longitude/);
  assert.throws(() => crs.toLatLon(2226, 6e6, undefined), /easting and northing/);
  assert.throws(() => crs.zoneFor(null, -121), /latitude and longitude/);
});

test('crs.js has exactly its three exports, and proj4 is only ever loaded by tests', () => {
  assert.deepEqual(Object.keys(crs).sort(), ['fromLatLon', 'toLatLon', 'zoneFor']);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const dir of ['public', 'src']) {
    for (const f of walk(path.join(ROOT, dir)).filter((f) => /\.(m?js|html)$/.test(f) && !f.endsWith('_worker.js'))) {
      assert.ok(!/(from\s*|import\s*\(\s*|require\s*\(\s*)['"][^'"]*proj4/.test(fs.readFileSync(f, 'utf8')), `${path.relative(ROOT, f)} loads proj4`);
    }
  }
});
