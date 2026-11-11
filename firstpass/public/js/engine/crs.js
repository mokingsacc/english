// State plane coordinates for California: latitude and longitude to and from the California Coordinate System of 1983
// (CCS83), zones 1 to 6 (EPSG 2225 to 2230), in US survey feet, x = easting, y = northing. Pure JavaScript, no
// dependencies; the page (the aerial photo, draw/underlay.js) and the Worker load the same file. Tested against proj4
// and PROJ's EPSG database in tests/engine/crs.test.mjs.
//
//   fromLatLon(epsg, lat, lon) -> { x, y }    toLatLon(epsg, x, y) -> { lat, lon }    zoneFor(lat, lon) -> epsg
//
// Each zone is a Lambert conformal conic projection with two standard parallels on the GRS80 ellipsoid (EPSG method
// 9802), written out below after EPSG Guidance Note 7-2 (section 3.2.1.1) and Snyder, Map Projections: A Working
// Manual (1987), chapter 15. Zone constants are EPSG's (the same as the NGS definitions of SPCS83): the false origin is
// 2,000,000 m east and 500,000 m north, which EPSG gives as 6,561,666.667 and 1,640,416.667 US survey feet; those
// figures are used as given, so the numbers match what Civil 3D and every EPSG-based program show. One US survey foot is
// 1200/3937 m.
//
// Datum: latitude and longitude here are treated as NAD83, and WGS84 is taken to be the same datum. In California the two
// differ by about a metre (roughly 1 to 1.5 m today, growing a little each year as the plate moves). That is consistent
// with the photo: the tiles come from the USGS NAIP Plus image service, whose imagery is made on NAD83 and served in Web
// Mercator with no datum transformation (the service lists none), so a tile corner's latitude and longitude are NAD83
// numbers already. Applying a WGS84 to NAD83 shift here would move the photo off her state plane grid by that metre.
// Coordinates from a phone's GPS (true WGS84) can sit about a metre off for the same reason; NAIP's own placement
// tolerance (a few metres) is larger than that anyway.

const A = 6378137;                    // GRS80 semi-major axis, metres
const FLAT = 1 / 298.257222101;       // GRS80 flattening
const E2 = FLAT * (2 - FLAT);
const E = Math.sqrt(E2);
const M_PER_FT = 1200 / 3937;         // US survey foot
const FE = 6561666.667, FN = 1640416.667;   // false easting and northing, US survey feet (EPSG)
const RAD = Math.PI / 180;
const dms = (d, m) => d + m / 60;

// EPSG code: [zone, latitude of false origin, central meridian (west negative), standard parallel 1, standard parallel 2]
const ZONE_DEFS = {
  2225: [1, dms(39, 20), -122, dms(41, 40), dms(40, 0)],
  2226: [2, dms(37, 40), -122, dms(39, 50), dms(38, 20)],
  2227: [3, dms(36, 30), -120.5, dms(38, 26), dms(37, 4)],
  2228: [4, dms(35, 20), -119, dms(37, 15), dms(36, 0)],
  2229: [5, dms(33, 30), -118, dms(35, 28), dms(34, 2)],
  2230: [6, dms(32, 10), -116.25, dms(33, 53), dms(32, 47)],
};

const mOf = (phi) => Math.cos(phi) / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
const tOf = (phi) => {
  const s = E * Math.sin(phi);
  return Math.tan(Math.PI / 4 - phi / 2) / ((1 - s) / (1 + s)) ** (E / 2);
};

const ZONES = {};
for (const [code, [zone, lat0, lon0, lat1, lat2]] of Object.entries(ZONE_DEFS)) {
  const p0 = lat0 * RAD, p1 = lat1 * RAD, p2 = lat2 * RAD;
  const m1 = mOf(p1), m2 = mOf(p2), t1 = tOf(p1), t2 = tOf(p2);
  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const F = m1 / (n * t1 ** n);
  ZONES[code] = { zone, lon0: lon0 * RAD, n, aF: A * F, rho0: A * F * tOf(p0) ** n };
}

function zoneOf(epsg) {
  const z = ZONES[epsg];
  if (!z) throw new Error(`EPSG ${epsg} is not a California state plane zone in US survey feet (2225 to 2230).`);
  return z;
}

/** Latitude and longitude (degrees, NAD83 taken as WGS84) to state plane easting x and northing y (US survey feet). */
export function fromLatLon(epsg, lat, lon) {
  const z = zoneOf(epsg);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) >= 90) throw new Error('A latitude and longitude in degrees are needed.');
  const rho = z.aF * tOf(lat * RAD) ** z.n;
  const theta = z.n * (lon * RAD - z.lon0);
  return { x: FE + (rho * Math.sin(theta)) / M_PER_FT, y: FN + (z.rho0 - rho * Math.cos(theta)) / M_PER_FT };
}

/** State plane easting x and northing y (US survey feet) to latitude and longitude (degrees). */
export function toLatLon(epsg, x, y) {
  const z = zoneOf(epsg);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('An easting and northing in feet are needed.');
  const dx = (x - FE) * M_PER_FT, dy = z.rho0 - (y - FN) * M_PER_FT;
  const rho = Math.hypot(dx, dy);          // n is positive in every California zone
  const t = (rho / z.aF) ** (1 / z.n);
  const lon = Math.atan2(dx, dy) / z.n + z.lon0;
  // Latitude from t by the fixed-point iteration of EPSG GN7-2 (it gains about two digits a step).
  let phi = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 20; i++) {
    const s = E * Math.sin(phi);
    const next = Math.PI / 2 - 2 * Math.atan(t * ((1 - s) / (1 + s)) ** (E / 2));
    const done = Math.abs(next - phi) < 1e-15;
    phi = next;
    if (done) break;
  }
  return { lat: phi / RAD, lon: lon / RAD };
}

// ---------------------------------------------------------------------------------------------- the zone for a site
//
// How the zone is chosen. California law (Public Resources Code sections 8801 to 8819) puts each county in one zone:
//   1 Del Norte, Humboldt, Lassen, Modoc, Plumas, Shasta, Siskiyou, Tehama, Trinity
//   2 Alpine, Amador, Butte, Colusa, El Dorado, Glenn, Lake, Mendocino, Napa, Nevada, Placer, Sacramento, Sierra,
//     Solano, Sonoma, Sutter, Yolo, Yuba
//   3 Alameda, Calaveras, Contra Costa, Madera, Marin, Mariposa, Merced, Mono, San Francisco, San Joaquin, San Mateo,
//     Santa Clara, Santa Cruz, Stanislaus, Tuolumne
//   4 Fresno, Inyo, Kings, Monterey, San Benito, Tulare
//   5 Kern, Los Angeles, San Bernardino, San Luis Obispo, Santa Barbara, Ventura
//   6 Imperial, Orange, Riverside, San Diego
// Each zone touches only the next one, so the zones are five bands split by five lines, each running from the sea to
// Nevada or Arizona. The lines below are where one zone's counties meet the next zone's in the Census Bureau's TIGER/Line
// 2024 county boundaries (public domain), simplified to within 0.0001 degree (about 11 m) and stored as encoded
// polylines (latitude and longitude to 0.00001 degree). Each line is carried due west out to sea and due east out of the
// state; the line between zones 5 and 6 first turns south past the coast (to 32.4 N, 117.95 W), so that Santa Catalina
// and San Clemente islands stay in zone 5 with Los Angeles County. A site's zone is 1 plus the number of lines it lies
// south of (a ray due north from it crosses that line an odd number of times).
// Checked when the lines were made: the inside point of all 58 counties, 23,200 random points inside them (one wrong,
// 1.4 m from a zone line) and 43,000 points 150 m either side of the lines (none wrong); the test keeps 208 of them.
// Error case: a site within about 15 m of a county line between two zones (the 11 m simplification plus the Census line's
// own placement, which is not the legal survey) can be given the zone across the line; outside California the bands
// simply carry on and the answer means nothing. The project's epsg is the override for both.

const ZONE_LINES = [
  // zone 1 | zone 2: Humboldt, Trinity, Tehama, Plumas, Lassen | Mendocino, Glenn, Butte, Yuba, Sierra
  'm~csF`bttVnFi~TWkcFZee@s@sqBd@w|Ck@uL^}GY}XMkeIkBikT?}_Bz@o]HctF]cw^xKTxmCAe@ayNCuhHV}U_@ch@]m~\\cCg`p@`@uRBgv@' +
  'o@owI`EnF~B}F`FyGhGqE~@eBn@mDrJsPhAkAbCVfEgBrCkExBd@lDhDfBZ|BqAlJH`LeEvKeBnDXxD|DlHlD|B|BzGc@rDkAjP{AjKz@bY^|A' +
  'cDnAiKfDsCtEsAvEkN~E{IpHyA|BuBvBsElAmN`F{DsBaTbR~F~FfDpBhCd@hJxBfEb@bD~BjEsArGvBzGtCpBrIX~Ss@vHhEf@AvE_EfHLpBo' +
  'AdCSlEP|C`AXlBhFtGhAdMhBxHnFhFlBdDz@dKAbEzChLWjGf@vI|CdHdCdPvAlFRxDz@hDL|Ge@fCzA|DxBxOrAnC`InDtJgEfEwE|DuAtJy@' +
  'vB|AlPj@hBoA`IaAtBmAhHXnAcBlAhE`CJzC~@nDhDbE_@hBhAdJMbGxArDs@rBtBxBh@zCiCvBc@zIi@xEr@~HbDtBrEfCPrB~AbEMrHjErF}' +
  'A~EiHzFmCxCWzAv@zJ|ArAbCjARl@nA`EJxAw@dAz@vBb@hM~LxJvDzFeAxFD~Aa@hDqGhHvKv@Sx@|B`DvDfHlA~EB|Ao@j@bAxAn@pJhCtEt' +
  'F`G}C~HoKxBTxBYpB{BvBs@dCErCeFn@eJtC{KpE}E`FeJlJkJzBy@bGlCpDTpFwAfJfCrDCrFiBdEAhDq@|FUz@VdGwApJgAvPfArEeArBeCp' +
  'CsAzN}BrDO|AZxAu@tEdAbJAxFoBjIfAlBUdAk@vEa@jAuAhFoKNiAjAAt@g@pFsMy@sdDmEFjAooByGcuHIw`JhEu``@_AueL\\ydCt@klA@kq' +
  'D_A}lHhDuzI[as@e@kEGuSAgqVjC?rBeeKVk_@dByWWyF@qmDYoy@\\wzBc@}qMiQtK_KjDcDtBi@zJ{BdNgRj]yMnQmElJsDvDuE~AyEMuDiCk' +
  'JgSiGwGoGcD_OyBoXeKuHTyG`CcIdNyD|KuDxGuLfKaSrNwIjFwFpBqIiC_NgJgFgIeDiCyAkIeNkVmFqDeTmJyR{EoPbDyKr@wJ{C}G_GwYka' +
  '@cOkMkYePuLkM_DiBuAo@qL~@aBbCqFjRnBui^eAes@uA{MeAmrLgWzKmAafBPemAcAoDmQcOcDsFiHiHiSgXm@mA_DyPuIqL_MeTi@kDyIqXu' +
  'EeG_HoFsL{AmIBcD{@gGQsC|AkEr@eCaAyDPmTsBeCPkDgAeJAyCsAwKjAuBo@wB?yC_E{A_AiDMqKgDcDV{Dc@_BZqGE_FgAqPoAiKgFmGiBc' +
  'B_BwBm@gLaH_BoBaBi@qAoBuCeBmDkFiEuBmA_BmJcD_CoC{H{DcAkBqDmMeC_N_C}DuFwDqJiDmQcE{GqD_BI_BaA{DJqD_AeCEcCeAcB{C_L' +
  'uLiA_D}@yZkBqJmVs\\iIoO}FoHkMyJ}VmDY}FlJs|IyyAc@n@a`AeRf@_aDhBh@c~@{uABNwr@wn@gB|@ot@as@QA_~@wNSSqPw`AKmu@b@gfB' +
  'D`@k{@el@t@Zm{C[s|Hsm@AK_zBil@Af@y|@ol@CnAwvC]qV_PVq]y@Ns|@avBE_Sed@WsAhAwfEjfDhAhy@EgAguBhl@b@Bc{@flCz@Ci}@nw' +
  'A~@F`j@h@xKUvCrzAn@Rv]f_@t@u@~oBzeCASby@`|AOG~|@vdAUriBxAp@wz@bsDL[lz@huDrCBiz@rxAQr@xuBvyAIUouBlzBzCxx@^XwoAp' +
  's@aBJ{qBfm@DIquB`{AiClA_z@xl@y@vl@D?yrBpzAFZsuAxwAqHNux@jl@RTotAlVPJu\\rVFNo[fvArDkF{lB~yAq@t@skBvXeAbXaKdc@Sa@' +
  '}rB|yAs@@asBfuAs@EoI~fAq@Fgf@tAgiAzyAq@i@ivBlyAIRwq@xk@_@Qgo@pk@KEusB~qDz@Mma@d@azAvR[dB]~SAVmtB~k@^\\uu@~~@EGy' +
  'z@`e@qOo}AcvC{G_Ik_D_bGYcIZoJ~AoFxDqDSuB{BqCu@uBdAkGwDiHaD_Ej@kGi@kIyFiEmCuNyAcAaEkAkAyAa@sBU{Oo@mDeLmNqA?wDrA' +
  'qAm@uAcCkC}JRsBlCcEZwBU{C{EqB{CqKmAkBwA[gG\\g@S{DiHeEkDkFiTgEcGqJwEsGgIiEgD_HsAgGUsEqA_AmBqFeZkAmDeAqAo@GsEx@u@' +
  'IO_AfAeKMmEwB}EyHgKeDkGmCmCkAEmEnCkHdIqBnAmAGePwWgCmIuEeKiFqE{FyBiCwE_BHkBxAyAWgC{CqA}F}A[uCjByAN_CmHm@IiGlDc@' +
  'm@m@}Em@e@{B`@e@tEk@~@oBFmAkC~AqJ_@kB}AqAqBNmC|CcBv@aEiCiCEcDiFu@_@k@n@qAvGoGhByFeCGqFwBwIcgFj@yKqS}H_HwGwTgBs' +
  'Bsa@}MoDg@kJw^_C}EyHaHcNeHu@cCI_Fd@ce@wAuFmBuB_HmEyAoGCuAbDwNi@wPi@yCoKiNqG{EcGsCwDwKwIwFyCgM{IqKsG{NqCyOaAwMu' +
  'WuM}AaKeAkCjBKnAu@fCuFbAsInBiFvBkClHgE|DuEbB_EpAiGReDa@eEdAg@fH[nMqCzOsKbJ{E~JuDlAiB|EaP~@qGTmHpJsWlAoAlA?vCvA' +
  'jAI`AwAp@IbBFnEtBfA]bEkGx@uEtJ_EjGeAp@[`CiEzB_Ib@yDWaDoCmCc@aBJmEiBuQhAkE]_FbGuAn@aBtPwBxAwDI}@_DgFkD{ZKwDaDi@' +
  'iFoLmFaGGk@zG_F~JoDpCIrBaBnLZnAq@`@jCvFdAbCxAzDHzLuGnCm@`BObDj@hFaAhLk@lFwApK@xBu@vEgFbCoEzA{@pK^pAWjD}DkC_I_A' +
  'sOxEsNrAyLrBkBnAyGHkOfDmF`OeKnCR|Bk@rWrDqDcNvCsS?}DmBoFjBwHIg@iD}B{DPyB{Ft@yM_DcHhAsIGsAwBgGWwG}@oBgKeFwJj@oAc' +
  'Aq@_DlAs}@kHoN{@eGz@kHcAsI]uR`RqHfAgAlAuJxCiBtGiJ|E_EzCeIf@wGtC}DXqDe@uBKuGb@iBfASfEj@zCm@t@gAXkBIiYxFoOHsAaDe' +
  'TF{LWeCzBqCpEiO_@yBJoAh@w@dIoE|@kFdCaDfJuBtDUtFmGz@eBAgNp@o@rBc@`HoFp@{AhIEnBaAxBqBjA]rFsFvEkHBeAy@{DQmGuDeCDu' +
  'CpCcQpCeBpBaC~FoBtDmH`Ck@xD}H|Eg@tBiC`BErA}@h@yCvDeHnCyArFaOr@k@rC_@hFoDpCaDtFcCn@iD]sCsEaFsJ}GQqPeA{Ai@AcAnBu' +
  '@?i@q@a@wCToCcByBwCm@c@mF|@oEkAeIHeDcHeNsB}IcJ{OkGcCmCYqSwLuFoAy@kBeBqASgBa@_@eHz@aCqAq@RqDq@_B~@}K|BqBi@mDwCu' +
  '@MaC^aDuAoF`@m@p@oDhAsAiBqAq@oATb@ibUGcyF[sZ`@kbEeC@_H}uBGmvLvCohQeBafBSq{AvAyJfAq|R{F}bCt@e`GMgoLgtALKc{A',
  // zone 2 | zone 3: Sonoma, Napa, Solano, Sacramento, Amador, Alpine | Marin, Contra Costa, San Joaquin, Calaveras, Tuolumne, Mono
  'svvhFvupnVjCqs@]cbWaAeCmAy@oCc@{@_B}FaT_AcQeAqCiCiBaE?kHxA_HTaExCuCj@_BkAq@uC?mDtDkHIeB{NiT`@qQu@yBuLaEmBqBc@c' +
  'Eh@yZsBwPxHgSByAi@uBeCeEuEeBiDc@yDiDsMg@uAeAmBgD]}D|AeUdEeMbCcD|FwNf@qCv@iUbBgFlDqFdCeO?mDo@qB{D{Bw@cC`JcVH{Bs' +
  'FyLu@IqAn@kAiAuDwNDkBrA{A|Bd@lArBnAhI~AtAdB`@|Ca@|C}FQ_ByDgD_FcIQwGcCgH}@eFJiPfAgDjDeEvO}Ev@{A@aCwIiUwGcAgC_E{' +
  'Ao@oAVc@x@gAnEsDtIyG|E{Cf@}DmPkLoImAgBYiCPiPqCmD[oB~AoQfBqFx@o@pFpBtAlC@|EnA|E~CnCrJmCfDeCVs@Uc@PsDyG_RqBaJqBo' +
  'ESsB\\gJhAsAzJuE`_CuzDzkFw_Jjo@_dApaGm|JUuhBjB{IzHcU`IuOf@[lCDxCgCbBPhQas@_AeD\\sC|AiBr@qFdIeGd@eDoA{B@wDlB}IfB{' +
  'Dh@uYnB{FGgDcAaCRuGbBeHpBIfB_EdAaANgAhDoDr@wFx@g@dBmD`AYhDkDLeHc@iCEiJlCgDL}@[sCs@oAwA}Gh@gMiAsEj@yBLaJ~EuDx@i' +
  'ExEuF~CUf@_GmA}B{@iEQsHf@eDnBkDjBaIjCsDZoH|@uA|EwChMqS@oBm@kBdAoVGgHjCmPPoL|B_FzCyAd@wBd@_LcBwAMcA\\_BWoCNaIhAo' +
  'CcAqF_B[gBmEcCTaA}EmEEuAy@@qEz@gCuBeGXgCpBeBGeBiCyCbAmG[_LRgIdBgEpDwCfAiDc@mFiBeGTcCrA_Cs@iEvB{Kg@oHeAyC{FaC{E' +
  'qEqEm@qDeBaAaC{IuMg@eB\\aDoA_EsBiCoAeL@k@bFcFzEjAtB}D[_D{AYOa@NqIyBwEiCoABmEq@wErAmBxBq@LqAsDgD]cA|@q@`Cl@pD[rC' +
  'gHUgClJoGXo@HaWl@}Ek@}N_C]o@RkD`J{BvCwABcA]qAkBI}JbFeDhCe@xC_CnCqEbCwKtAoB`Be@nAT~MxEx@`@pGtIrC~@hCmDtDuObAaBv' +
  'H}AtPt@pGuEpBaMXsIgAkIaEoK_@{FXmE~@_CbCeChDC~EfEpAhBdFrNzEpGfD|BvHxAzCMlEyArB{CtBsFrIkf@LyEq@yDmF}J_@kCRgB`CwC' +
  '`QyL|UwVlM}PxKmSvUon@|E{IrIgLzKsLtLiKtOcKrHmDvVeG`G_A|Lk@dBmArGwAx]yN~GuEdDeDtPaSbH{PpA_LrBi[djAoaGz|CklS~hAun' +
  'LjHmpAiXs|BfP{jBf@ePfRmwCpWeiB|e@oo@`dAgt@nKwQdEqWv@aCxIkfAGca@sAmVmM}o@uFin@_D}G}D_DgBuCqB{I{CiFwq@}wBiJ_b@cD' +
  'kZaJu[kLai@yB_Gea@iv@uDiMeFmWbK}~@?izAhEap@{EoTkKc_@qFc\\mJcwAmK}nBzAwb@bGg_@`Y}}@dUyg@vPw\\rEAjHwb@|Lug@vGiSnHy' +
  'c@~CiVpBaVfCch@r@w`@G{S_AiLG{Ti@iMyEey@yKuy@iK_a@gFuKmFaIiHeIyM}K{QyLmNsH}NiEaEUa@Q?{@bEsn@|@oDb]wi@|p@c_@zh@{' +
  'Epf@kOhYkVtU_LfRiXRoA|LwVhA_D?oApRc[dFsNbBwMp@sOEkGgEcd@S{Jg@g@f@g@nBaRvGwRdEy_@AsL_@eERsS_Bm]R}CuL{i@mI}XsCwQ' +
  'yBs_@m@ky@qCuZsHsh@aGoRoFqMk\\oi@kWmu@iFoZqEcQ{Ns_@cPs[{r@qq@ka@mp@{LiMqDyBuQyEeZ]cd@rAwFh@yWxGwGh@sl@gOgYye@cL' +
  'gaA?uB~Wi|@zHuSzCyBxDgFvDgJjEe\\r@cNs@mHeDsMuGiIau@oUcC_CwAaEaGytAm@qu@|TwyBfH}Q|DaEaEuMaHm]o@{PoCcXqFuIoCkDqLq' +
  'BaHv@qIdFoCv@_E|GsOrd@gI`g@}AhFcEpFiHlHaNpBaNx@aKy@aKcFqOeKoDwHwHmFgJyJ}Wul@kQeh@}AuIGoOs@oAkF_BeBOgC^qKzMgE|A' +
  '{DcAcD{BqA_EyDiWc@}DHgIy@cFqAkCeH}GmB{FXyEhCsIM_Co@kAqBu@yO}AkBmAgBwDKyErCoOMoC{@uBuJeE_M{CmAf@oFbHeB^iAi@gJcN' +
  'gDQoFh@uB}@uAoFO{Dc@k@eLgBoHyCyGq@kCcAcCqCyIwUqAkAmDs@mL~@gMlHaEYcDNaDhBcD`E_Bp@_C@iBe@eCiByCsIqBoCgGm@wFvEeKz' +
  'BuFrBsI~GuGvC_Dh@kHq@eCcBoAoBoD_MgL{EuDwF_IaFkE_Hm@cDAoDj@kUrBsJEiAmDuHeGsIyNeIgLk@qDoE{GsMuBiAyAEuBhAiDJaJbB}' +
  'IjEqWxEyE\\uK{En@w@e@aJ}ByC{AoGuAuB}CyBwAiEiAuHC}CpBgJoByKNgCz@gCoA{CoD}BiEqAiOX_D}@{DkEuCyIyAeBiCsAyDe@oBHuGtC' +
  'qF_AmByAqIaT}J_FaFoLcEsGyMiA{Nz@sEhFmBz@qDP}MuRiAcA}EWaAo@}@cB}A{H{FkNOoC`BgLoBiMzAyKpAuTdCqGlD_Cf@cAb@qEkAeIN' +
  'eBrJmNfEeOUeGcBaJyDeIiC_DNuCnBiHbAaK`EwK}@kGRaF~CeHG_FiCgPn@cIrIyEpHmB~AeLhCwAnUv@eA|Ed@bAtFnDxDgBnC_InCObBcEh' +
  'BqBnM}DrAgAzE_IxDs@~@q@pC{GbBwGnAqKvFyE|@}EdCqEbHqF?k@cDo@m@sDvD[`@_@FgAcBkCjBwAv@sB@sEdBaAEaBjDe@j@q@PkE[iAiC' +
  'YY_@BiAd@q@MkFpAeA`DC|EeKzD{DPaHkA{Du@_A{Ee@yA{@mDiPuEgHsHeG]{Bv@sFdIuOGuC{C{JhDeIvBmMLcCeBs\\~EuEh@mFmAgHmE}J?' +
  'kFx@eBlGwBlAeAzAiBfAaFYcCoC`AiA?mAcBgDcZ@}Iy@cIdAySx@oEfFcIjCgGlAeKMqE_@}BqEwCi@eCFiEbCcMY}CcA{C{IkMkAmSq@sCsE' +
  'qJXoEuAaD~@aIw@iCAoC`CyE_@gGMs@uB_AqAaB[iFeAy@sBeG{AyArA_B{BoFSiFvCkJoBoBU_ElB}BwDuJnEeK?eJyA}GoIeUsCc]{GuQm@I' +
  'oEqFmDqAiDsDmKaCeJcGuGwIgA}EiEmHyE}B{@wEMwEjCwKj@eHuAwEiFyJMyHmB}IuBmEeAkIZsLlDuHP_B]{EtDiQZ{EzJcSvBsIbD}GtAkS' +
  'xEqJr@qOo@_OoE_LkAo@e@gI{AuDr@yCg@mMfB{Cn@iJMkF_DwGt@gClCwBjDyGdDiEbByNgBeMkIwRcMaOHqgAkQeX{CeGoSqW}DgLJkDpBuG' +
  'GeLkBySc@kMlCaH~CgAh@iEs@aS^gQoAyEeGmC_CeDyEqQuDmRm@iB_CyAiAqJ[oN\\}KsC{K}DiK}Ged@cHuEuLaRgIkG}DyLkEuDqAwCuAcJX' +
  '{KiBkCmEeDmB{CiC}@yCoG{E_DcBgBoAuCc@yNw@aEw@aPD{GdAaLzAqF?kB{A_EgEeD[oB}CeGcAwGcEwIgAoPyFoSwA}B[wBvBoKyAeHp@}A' +
  'tAgA`@sAImB|@wA@kAdAeC?eA{@eALgBmC}EwAa@_BD{@i@FaDu@qDJgF]yAqC_CkBI@yCu@eB{B}DwCyCFiBnBgCJ_A_@kAaIiIiHyPiD]{Ew' +
  'CoA{KgFiMeAgAoDyAoAmHqBqCuKgIqDeBgCwGk@gDBoEcAeDhBmRhDsEhEiCxAmFhHkPL{A~EeFfAeCnAw@bCkLbB}A|@uBQwAh@cAEkDtAYP{' +
  '@i@wF{Aw@wB{E}AcBs@I}AiC_@}BeAWcA\\u@M_DmF{LmJCgDw@kCRuCYiDDuJgCaBGw@b@_Ac@Ok@mBDaB{@{@HoKx@eDeAuGaCgAgAuGpyHab' +
  'C?Zv[gJn{B}v@c@}J`AyFr@uAxC{@`A}KlG}G`FyMn@gFCaD{BgHBsF~CaN~Q_h@IiA{F{EgAgBiDkOCeFtBeCl@yD?qCm@cCwAqA_E{AmAqAc' +
  'AcCeDoU_FcIwHqGyC{GEcEhAaL~AgHbDkIfGe^hDeLhBkEtB_CzB}F_@kImEeLaRaTcDgJ_DiEiEoI{Kmg@{@iGImPpBwLlKmTdEmFhGoEp@mB' +
  'WwCdBiE~DkEtBm@hCeEz@cEAgJzCuUq@QMw@p@eKy@yDeAoAmFmD_KkE{NgJ{CuEm@{CM}EkAcEmIyJwKaD_B{EmAs@yRz@aLU{IsDw@sCHeAf' +
  'F}JQgIgA}@eGu@gBiAqAaDMoG_AkBgIeJmCgIQeHiDeSw@cR{BsHqAiI{DuIcBmB_FkCoCi@_M?mDqA{J_GqHaNaIeFuCg@{HUcGcGqDx@_EiD' +
  'UcCTqMa@}B{DoNoJuSq@yCDyFm@iBgHmP}IuMeEeI}D_F}CqBeByCiD{J{AkIeOgFqBHiH}D_IiBiAk@UkCoGgDkAgDS_Fh@aDz@yBhBiBnFsD' +
  'bA_I_@qCqAsAwJ_EmCC_GsCiJQmEsBa@yAFiB`DgETkAo@kCmBgC]_CxBsF`F_HxE{CnAaCH}C_GyPeFeRqBsKaAu_@bGmf@OmG_EqP_@oGFkK' +
  'aBiIqE_OCaE`ByZc@uLxA_KnF}Gb@eCMuCg@}AkJoFyMgBoSmEkJ{GTe@oQ_YeZcW{DcFyD}H{DoEm@cDaAwP|B}I?iEuSkq@w@cHyFqHwCyPO' +
  'eSmCqCaDuA}@}DgBsc@sBmVeC}H_DcGZQ}AsIv@eYU}I{DkYgDyIuBwB_R_HgGgD}A_ByCmHcCuL{EuGkBeFeAmA}FeAkDkFWwDl@sAxDsAfBc' +
  'Ea@wFiEwDiDwIiB}Q_@iKTyRb@gFlC}HKqDi@yBeHcKwG}MeC_RL}Jk@cAoLqIaCuCqDwHaBqHmAcBoE{CoA}DZkJhDwSD{E[aB}@aBcAg@iIg' +
  'BgH?oJtF{AAyIgFgOaHgIaBgTsABg@wCcBsG{R^yNMoG{@cDcEgDmMqEsHeAuEh@iJ`F{BEyAg@eAu@cEuIqAuS_B_G_GsHmCeA{BE_C`BcBdU' +
  'eA~AgBn@yHn@}FtFyKbDgDs@qHeL_B_A{GcAiQCgIpAcIxBmAEcCwB{DyO{AaD_BaB{DwA}XoDcDoA{AeCiEiMgAwHeA{PPwa@jAeV?oK[{C{D' +
  'uIe@cCiAgSmCuMr@q]IsD{AwFoCqCiIcDaIcFuCqC{C_AqC?cK|BmNrEuEs@_AkAgC_IuAyLKyo@yDgF{@kCu@eMi@yBeEqBuBaDNuH}GwDsBw' +
  'EsHgn@{EiH_@aBB_CzUgHnDwEPiA{@eO]e[aJwCcJiHuBiE~@wUcL}IiIeCqCkCcBqCuFsTmAsBqMoNoa@e[cFkHeBgIs@gA_Ai@oCMwFbAqDr' +
  'ByCd@kCOeBgBcBiFlAcNUeTiAi@_BFkFhKoCNqA[sK_[J}AjBeC`Bi@`GIb@a@vCqP~Bm^i@_I{DaFk@_CbAyJMyF[qCsFuQc@yDb@kKpCoHUu' +
  'EmGmN?yBpAuHfA{ClHwIlAsD?}CwFsLiIeKyAaDs@eEcAuS_A{B_FuEwDkKuEwCeOTuBeAcDgHuA}A{TuHuEuFqBsFuHk_@sIkQcDmJgLqTcGi' +
  'IWiAcG_JaFeBa@_Cf@_UMgH}@oCWgDjBmKzDcEhGgDpBHbCpApAElAuATqAcAsLKsP^eC~GcShCoSJqE_BaVc@_Sb@eOzAkIdBqGt@y@lDyBhE' +
  'o@fJuCz@s@zD_WC}GeDaLiCiF]{IqBkFiEyFiBwDyIqd@SsPxBmT`@qPpAyLQkC}BqGg@_EoE_mAtAyH~EqK|AqGl@mLmGwQsGcZkC}GuJaKkB' +
  'uFkF_w@o@mU~@oKeEgKmFcHcFuRuI_Se@qEAsJx@eSdDcT|CiHH{Ai@mb@e@cHeAiEaIuMb@yDe@iPePkKyAyB?u@k@AmHqGLeHgAqA}FgBaI{' +
  'EiDcHi@uP{CkNr@uGbCmDRsUi@kCH{Cx@qAlFwUb@sH_@cDeC}EaGyGyC}GiJqGyAyJFkSa@kPu@}HqAkA{LaSqE{J{HgGaDkEsD{CgCaKe@}F' +
  'sLa]w@qI?sK|AaMbCoIlCeUpAq[bEs^hDgMXcQrAsG|C{GJoB}@sEoB{EGyDdAeLs@wKPmU~BsKdDaGrB}Hu@}UgAeKTcHbC{GB}EeAmFyDuGT' +
  'sLq@wGb@oJaCwHuC_GsC}DoBwAFsLgAuDlAmNlBg@r@{g@MkGVCh@wDrDsJZiDW{IsB}UY_KcCqA[y@JcJ_@yF}DkOy@_AkImAkDyF{EoB_DqC' +
  'uAJc@_AOgKcEeGkBoGMsBxAqG|DgCTwAgAsLw@wAaHwFmBmFkD}QP{EhCmD~@gD_CmPc@yH{B}BgAsDSwClDuM?kAcAuC_E}CcEk[_@eHlgKPc' +
  'D{Jm@_XmDsFcHkCmAaCd@{E{AiCoA}@}@sEkBgEo@eGcDcMqBsCsEaBHqBwBwDbgA{jB|`AweBhFsGhhEkbJtqG_`NmRaM{r@eoAeHa]sR}u@u' +
  '@yEuJwRoBsB{m@qtAq\\ugCkAeEkdAw|@}AiE_FsG}EgCa@eAcTshBwPw[jGed@FwEaAmMaEeHGkCeB{CgCsB}BiIwIyJk@_CcALe^}y@\\mAMsB' +
  'mCuJBmA`A{BH}BeGspD]ao@fAuCpDi[xCiDt@wFrCuG~DyAtBoEhEiCj@oGlHuAxBcBpBqDbCy@`DCfDxApBUlB{AvAlA|aCwZ|e@eCptA`g@v' +
  'hBu}Df\\ef@pgBguCk@WEiAoCqCm@cHuDiHy@]}IYsBaEuKwD{EkE{F[aHp@}Ku@_GxCsHW_D_BsEh@yI_KuAo@kA_DkBo@yC_EoIjAqFjHuBbD' +
  'c@pJ}@vCkA`CiFxEcAzBwDmV{EuGuOcLs@sAaB}JkLeSgEiL_GuJiD}IaEcOmDck@oCyCaCIoA~@yApFuRvJ_FzDgKbOaLlFoQNsBpEaBfI_Db' +
  'EuDfAmGw@qRbCqD`EyFQiIz@_GbCoErDmB`@gGwF_J{KgKsQIwKi@kDh@wGiT}l@qFuE}GuAaAaHxGcNrFmIlMgKpHeP`K}d@@qOcG{@}EwCcF' +
  'oJmE_OcHoc@kEkP_F{KgWg[yIoEqTF}[}@kEgAiEbB_E`S{CnC_P`CiNkA_H~IeUdEsFXsDtE}CuMeFmNaDuGcEeFoGyFeJ{@oDd@}BcFeG}@{' +
  'IqMiFwEaItBgCNgGu@_IjA{MIyHxBeCm@i@JK`EaEf@{AS_H|@kKmDiRq@{FaAeIeDiG}AeBiAuDoOuDwScH}QqB_DqE_BaIYcDy@cAsAkBeGa' +
  'Em@uFwCqBWwAFgDzAoIzA{K|GkRnAo@h@yAFmFeAeLmFwBQuHlAiFAqHsEyBe@sDAGtDdArHMnH{AtJgFhEg@vB?nG{@hHYrTwApDaEh@mD~Bc' +
  'FlAiAzAoAcA[}AiAcAgEbAeT{@kKyG}FeBqGYqF`@}A|AiE~KcTtIsGrAuJOaDV}AvBuAbQJzDhAlBrCtA?dBkLa@iRNuVlFaJ`@iIOeCfGqB~' +
  'BkP`EX|ErCpGF~BuD`@aE|AkBjE_LvBoAfCm@rDkFdFyHx@aDlEwBjIcFrHyCfCwTlBgHxCcFz@a@h@KvF}R{@kLwByPrAiAz@o@xCRdFcF|Ec' +
  'Bz@kCYsCXeGuAwBGqHsC_FvEsD|AwFh@eBtAcGFu@|EiFtMcEnC_Dz@gc@qG{H~B{Er@g@zDqAnCcFfGiB`@sC~EiAdJuAf[qB`PiBnB_PlJuN' +
  '~FuDbH}Ah@}B~FcB`PkBjDaE`@cBuAeCGeB{@sC?{ArEiEfBgM|AcKNuDtAsDFu@mB}A}A}Js@_IsCaCsB_D?_Ch@_C|AyCz@kGXyCYcB{HaFs' +
  'F_Dz@wI_@wF{A}IbDuA~Eu@GcB{@wLyLyCEsGuBkFa@eGhBoAdBwAr@uA@oDeBaAbAiJhBo@r@_C?gDy@_C}A}A|@cBNqIcBaA}A}@_Go@y@wA' +
  'QyCnB_CPsLsBcEeB}Ey@uD@qS`BaLuCoE@eLbHeC|@_CcAo@cAM_CvDaZyA{HmFmNyCiDkAqCkDeReCcEmCgCuHiDcI_@oEeBeBiDiA{@cF@mC' +
  'j@gCaDmGyL{@k@uGOqB}GiGcBeDlAoHaAoA`@uA~Cy@TiN?mCs@yNgTaMaJ{QhBqBy@}Xw`@oQmKoEGaDfCaPpU{QlI',
  // zone 3 | zone 4: Santa Cruz, Santa Clara, Merced, Madera, Mono | Monterey, San Benito, Fresno, Inyo
  'oiv_Ffg}gVu[q|Hk{AelW}`Ay~JaGi\\{Au@_H_J{MiUyGkOqDcDoBy@oD_@yHByDz@y`@zNoDZkF_AaHiIiKuOeHiH}LmIsPeG_DqB_BuBaJqS' +
  'sG}EgJiJwC{KA}CvAqDkBv@bD_JrFgItByOa@mSo@aG{@kDmD}Gy@wEcM_QyD}H{Cw@uHk@eE{A{PwUiSgJkF{A}GuDiIgK}@{C_HyFkHeJoLc' +
  'WaG{FgC{EW{DzCsSp@eMA_L{@sJuOkg@aCmCoJsBeAoBQ{Dp@qFbBmDnBqI~G{HzC_H`CkC`GwOJuCkBeEkCcAmCcDk[wN`@}R}Q}XoH{O`FgH' +
  'hJCbRrNnNlc@rI{FhGaSiQaSeBmI`IePlLms@p[ob@aCkJsCyG{SeVgB{CyB_Mu@cByLwKuBaDaAaIsCkF_@}DaCoHMkBdAqUfDgNbFyHvIeGt' +
  'DkAdFG|QxDnFvBrI{A`HaIjAaDN}BM{@uAwAeKmHi@_Ep@wCnAg@rFGdRgBlCTzCdBtCGnHuAx@uDIoBkCiGcVk\\kFs@_JyGs`@qS}QcNoKuF[' +
  'uEfAcCLcHrBq@jBmEp@kGvGoMy@_InWkXra@es@iEs|@}BaP_@}c@z@cQfJw[|BgEfBgA|FiAzDkChG_IlDsBxB{EwBkDeHyB_BgAwDiF}ByF_' +
  '@wL`@eM~BuJb@mLkDmOu@_@iH]_Rl@qGIaEi@{A}@kHeBkEa@yJBmGeBeHiLyK{HqFyFqAmLcJaPBeHgHcMsAsMkByCoCiH}DsCaHsAsHnHgCl' +
  '@mAe@m@sBiAsA}BiAiBOyBgGmE}GaBoEkHcE_IeUwCeG{EsEoGwIkGeSuBoBqK_DkB}B{IiNmAwKeAgAeEaAyAeAgEcMeGsCkDmCeKeCmJVkBj' +
  '@{DNoCcHuCsAcNHqAbAiD~GwAr@eCTgB{B]sIiBmC}NwBsEcC]}L}@iB_EcAuGg@cCmAqCRq@sBgAgAoFsB_DqCmFmB{fA_oA`a@ouBxDyKoHk' +
  'ZcW|MaPiMuBwIw@yJgJsNRwB~C{@cGsSR_D_E_BYcHpCiHnHt@jBfAhBeDtOyHxGyS|Qof@pHyGvQyIjNaTpcA{oA[uLZw|GnBugBg@aBgA_r@' +
  'kC_nXbMoExDgFfCyBt@JzFzHhGdAxAt@bJvLtAt@nBeAj@N|RnM|N|SbAnE_@`J`AdDfO|NjCr@bBpDzNrGvHi@pEX`J~DnLlKbJLlD`D`NdAr' +
  'CeAzGuFtF_HbMmHHoDpD{K?iOjAqAxAg@zDXbL{B~G[lCaAhGpAjBeDxCM~FeDJaAcBmBmBmEgEqDw@qDoD_El@_NtBwCVqAbAcMjC}P@kF_@g' +
  'CqEmBWcAj@cDwAwFUyNgFePnBaG`AeJnDyNcBmKa@uJjPkKHmAxDoEdByElDqAtHjBpDYfOsFdC[zA?hIdC`G?hEv@nD~AlCMnKuIrEqAlD}Dx' +
  'KiIa@wIfF_HbKuC`J{Hh@iR`@qAIcDlAeClD}AzCJdCg@jAmBtGwCrE{Et@?rH~DpNaBtBwAp@mB|FKbLyBrEcBlE_Dx@mCMcDnD}DfB}Gb@sF' +
  'nAiA`AiCXkEYaE|@aE~CeIp@c@bD~AlDg@`CZdBi@tBLfBk@No@jC_BtB_@rD`@p@Un@YbC{G`A_AhFo@lAoAbHk@tAuA~EkAhD_EjGwBtDgDl' +
  'Aa@pFE|Eo@Vs@i@kARmE|D}CbI}AvHl@vLyBrJrA~I}E~BD`f@y_BzC}FjMu_@|k@}mB`X_dAhjAsrD~xCk|JnV}q@tsCupJfx@sjAtMyPwl@e' +
  'y@aMqLcyCebEuL}LmsAueB{}F{{HaoJacMygK{hNd@swKgtDQAqM{UEAiL_GIaHvAiCH_IwCq@uAcC`@aD~I{B~CGxBdAbBh@zCeCjGmFbCwC~' +
  'B_MhAkDhC]hCz@nEuAdHuBpFVtBgGiIuHkH}~CkhE_FqFcJoNyM_P{AkE}HkHc~@omAzBgDtEwA|DkCrC{J`BqB~CYfGzEfDu@|PDtBc@vEzCl' +
  'DbGbClBrB`Dp@dEpHzLlIxE~Bu@hDkClBqHrAqN`DkKzAuCvGyDzBSdC^pBnA`D|@vAqCPgG}EuMQsBCcFx@eDlH_ErCWtE?|PrHtCq@fAcB`A' +
  'aCLcGcGmSy@cKb@eCr@eAlEeBrEaEr@sBpAqVBoDm@}DV}CpEwLfI{K`CoB`IwBbEMfHhAvDLnDkAvAv@jBS~AiAhBmC^eCUkDmA}DiCkBc@qA' +
  'bAqErC{@zEbFtBbAnB_@tAkB|AgMdDmBvFLzGpCfDDdDq@xD_C|J_BdIy@nBv@`Bk@dBb@rCy@vFdA~HsBfFqGdFqKpCmCzBs@rET~D[bBiAlA' +
  'wCeAmRfKkKdAmCfA_RfCmEzGcAbDdArAvBfDrKdFdKpA`AfBN`Fc@pF_FxFoRjBmBhE}CfNmObOkD|GwHnB_A~Gw@hQxEfHl@rIwArGmF|EwB~' +
  '[mFrCyAfDkIfAsLG_GzBwK|E_FzHuElHe@lFkAtAiAdCgExCaBrKqB~CsCdCyGvHcJrEuHhBw@`Co@bCZzCdD|BvEbEjNxA~BvCnArCFtCg@pG' +
  'mJjBwFbAuJp@gWnBuI~BkD~BsAdDk@dD^pBrB~FjKxE`F`IrAhF`FLrAuC~UTvHhAfLx@rA`BRpAU~AsAlDoKvAuA`AHfDpApFlG|SbG`KtAfB' +
  'vAlA`FnCdBlFh@hNIbCw@|IeFnC}D|EgVzE_DlBmI@}HdCeDzMwKtBUdCtAvAnBzAnEdAlL~@rAfH~DfFp@pAKvJaKdF_a@jAyFv@mA|CMfFZ~' +
  'EfArEvB|GhEfEhEzAdGfCjEnCf@tAQzIwIbCkFgAmWTuAv@]hH|BjAc@jHgHrAyFu@cZlCiM`DsDpAKzJrB|MtG|@mBD}Hi@oD{D{L`B{ItBuC' +
  '|KmJlIyDhBc@xAl@dBqBvDyBpF_@vCuA|JsKY_HZgCaAaJv@cCdIwK|IwDxDkIW{GiAuHmB{CuQmFu@qAW_Cn@oFpJgDzHb@nBWrCeCnBaFzAq' +
  'BvFgBpEiFpAe@fJqBxMi@|DRvB_@~DcDdMuNt@qEe@eK{DoFoEs@a@uACwB`FqEHkAiD_KcAmILiFnBeHrDuC`FcJzCmCjWs_@~H}DbDWlWR`F' +
  'y@nBaAjA{A`AcCR}Ca@yDwDuGeDuC_AmCj@yLx@kA~NcFlBA|@f@xHnPtGtIdKjH`CPbDq@~IyGzFeGjCiErBsBbAOnCj@dJdEbF`AfM|HvCJf' +
  'HgB`DmB`D}@rDaGTaLe@aFoCiKyE}]gAuK_@yLXmGfA_HjCcFlEyNpBcQaBwGeCuB}Be@sE`@uA~@qGnOkCrCkErBqOhEuE~C}CdAuEXcEqAyB' +
  'gD]cEPmFdBoEfAs@~Ny@`LcEzFkExAwEMgFs@iGcFgUFiEx@_DvBsC~Ag@vKL|OpE|Kp@hD{AvAaBPsD]kD_MoUcC_L{AmQTgBzBoD~AuAbBYr' +
  'DbAlDxErFjDtIg@lDgB|DsFhAqDTgIUcNsBaJqDmG}Be@aCp@yG{C_@wFp@kFpHeMbAeEzE_`@hFsN`AiAhF_AnCUfDp@pAdAzApHPnUf@pAlG' +
  'dD~DGdDuAlAoDn@{EUuGg@{CeG}IeCwFeAuFWuT`@qEbA{BbBoAdAMzAf@fHlGfHbB~FQ`EsAvFqDfCuDnAuFA{C{@iD}@eCoAm@uCU}Dv@oIx' +
  'EoLlAmDa@cFaBcE}CqCaJa@eE`AyM|A{ElBaDx@a@xBLfLdEbJXpB{@^sBiE{NeFgGwGuFgPgBoEkFs@sFb@eCfNwMn@mDoBmI[mDVcIaBiE]y' +
  'KbAoIbBiBdCoA`HaLDwHuAiFmCgBkQmH}@cAiD}Ju@mIbCe@j@sBnEuF|Bk@v@iA~DsBbAiH?yGdAeHjBwGlBmQfAyF~CcEPqC[}E{BqQ}BsCy' +
  'AByDzAuJvHyPnAiEtDuJ`EcHByDs@kFqHoAkELgDz@qBVkUyByQ{@eCgHcD}KFkBo@c@}@s@}ImCeBu@_BAgQw@cCeB_AlAaBz@iITeIa@iEk@' +
  'qDeKgGl@}J]wDxAmFhAgDjU{ErJj@bI|AxLiLdAcDx@qPjB}EhLwF`E{EzAqG[oHu@oDiCq@sBuBq@cC}@}@i@oCeDAaDqCo@sEaBmDmCuC}Im' +
  'Gq@Di@|@yEvBgScBuHmCgJeH}IqSeQyKk]wBoHeCqA{Am@gBk@uLm@_BTqEzCqHlHgG`CcH~GwCbAeBpC}PPyFy@oJ}B_IyRa`@iDkB}@wB_@i' +
  'Br@cEaIoWaF{FmBmIm@cAeEiC{ImQ{AmLI{Ma@cCkA{BcFgEgBwHCgCjBuEk@_DBmJmAyBsBk@kFoe@e@eMj@qGIeDzEoGd@uGWiI_ByHa@iL{' +
  'C}MyDmKXyFsBqDgEs@eAgAqE_L}GaHqBq@_GsI}BiF{BcJgHs^mDwHmBiOvAcNjB{FdGeB~IqFtEoAfE_ElBeGHcCgBiQYsIyB_G{ByLaHoP}B' +
  'qCmAoIV{GhAaGH_HpAoE^mGxAwCtNiM~C}DfOq[n@qHmAiJIgE`@iAiA_LvBaKAmGhB{Ev@{S}DeNw@iAmBa@yAmAuA{DeCeDoIgEwXwCgGoCo' +
  '@cAy@aHoCgLqBiBqGyKQeAjA_Lm@yFAkGjA}Bh@cHw@yU~AyH?}He@uIoB}GkAcOgBiIyCiEsD_CsDXkDtAsEAkEh@oESqEoC{FoAsAeAaI}N}' +
  'BuHsAeJ~@eF~@gAfBqPrCsClHaC|G{EfEi@tF}UJ{BfBoChAeHlAkWoLg]eDmSIqIn@kQbBgJt@q\\~AcWoLwg@mJgN}^oLiGf@eAsAoFqDwJuK' +
  'uBgFQiErC{J?cI|DaG~AsHfGcN^gLyAkXqCyNyA{CuLkGiD}DgD}BkCmDsAiEoAwILyJcAyD?qH{@oGr@y@n@}GCgFb@sBsA@`A_Dd@uEKyEy@' +
  'kEyC_EuJu@yA`B_H`CaADoCy@yBoAiBeDiAwGImKb@oDdBiDpHuHrCqH|@?dPgj@fEoJc@sJ^iDnAqCaAiEdBw@jBEeAkEkLuKsByCcAeF~E}K' +
  '{Bu@lKkIwEOhH}Er@}CEoEsAeGqEkHoCwCwCiByDVmFsBsMqGcGuGoAiG]}H}BcPXgBlAcAnEuBzEiAvAkCtAbA~BNtEmA^e@lAGtFqE`@`@|H' +
  'uNFqCdAcBdCiMq@W|A{AjHeY`B}@`CgNt@_Ar@e\\a@_CuCgF}A{EsEeAjAwEAgBs@a@aIm@mKoEcEU}Bh@}Ho@aBj@sCfCaFlImAn@sCSyCyBi' +
  'GqI_EaC]_F_AmC|@iCUeEeE_MmA}OsA}Dw@aAuFw@oCkAkNmJaT{HsEoDqA}BqBgIg@qJqA_JCgCnAuEDeB_BsEgM_LwDoBeQoBoKEsDx@Bn@q' +
  'C|AeEdGoPhJ@cC{IN}EdAoDdCmB`@_EGoGcA}C{@yDiG{aAajAeb@oG_WyHk@kh@uCuPuByGOuRyLsVkKaMwFaCiLkIaBYuLPcG`CgD|F{E`Bk' +
  'Hm@gC}A@aBgEcGaCaIyB_CiDyMyBuCqWkP_A}A_BeIxA{JYkDoAeEkEcIgEoDiGa@}GzAuLlHuHlBcClBsAlFpApUQpDw@`BaCnAqFIoXsGaYu' +
  'AyWiDmIV_B_@kYoVe`@_a@aOeUyF}KoByFmLmSmG{FeIwOmCgL{D_G_C_Ak@_BkHmFcJeM_IeHkBsAmG}A{FoJmDcAuHuLmAgEqCyEyHmE{MqA' +
  'eHsFyLiYmEiRnBsRpEyPfA}LcAoJxF_T]gg@sNqu@yHkUsD{BqL}BsNq@gd@xAqbAzImSNeD_I_FeT}KmPkBkLu@iK~A{q@du@o_ArGbBvGdD`' +
  'MrIzLzNrKlGhIl@lLaDbCeGQyJgYwe@qDaUkBgGuM{JiQ_BcHgJaBkAoHmCmM_A}EwBuc@eYkEkA}^xQmFl@qHqAmNoIgJmDuJ_A{Mz@uO}DkD' +
  'uEkDwAeIgGwGcAyDsAaCiFyBk]BmFbA{JvEaNfFuGrD}JhHkJjEs[_BsXxNalAwAmHQqWuGuHwAAoElAaJd@wD{BkAuCiCSqHhDwEbImEx@}Jk' +
  'BaJ}FgUoDcPsE_KDeJqByDsDuAoCkJwKkGcLeM{d@_AgII}Ng@kCiBqCkDsCqLwGcGgB}NkCmFgBqEQwI`BcMnIyFpHyEvJ{WlTuE`H_AjC{@n' +
  'Nn@rDzE~Ln@jJoA|UZ|]i@bNm@lCeB|BwAp@qF\\eGmC{IqImJaEcJcC{HgEaCm@kBCeBy@wXd@wF_A{OTkKnAkFaAmG_DyKiJoC}Gk@qQeAaBU' +
  'aEk@_B_Bs@a@{AIcI~BoLrAeBlB_I`F_HnHyG~GgJhJ_Hf@_ArGmCt@Il@h@l@YrBcDtAmF|@gNxDoMb@uDpIuMtGmHlB{E`CkBpAcGHmGuAiE' +
  'iF}BaOyCwK?iE{@mRsMiTuEiJyCyIiAmDAmAm@eAyAy@sNmAyE{OsXIgOf@gC`GsI~FiBnE{E`DsHzG{Jn@uIU{BpAiCjDgAbAcAzEgNhCoCpF' +
  'gDnGoIdFkCtFu@~Gh@bFxBlCfDtDtCtFrA`QBdDj@fMtF`D[~G{C|CaAxCSvEkBzEoI~O_NnEkDdXiMdBaDzByEh@}Dg@kDqBwFIaDfAuLCiG_' +
  'BoMUiI{@uBiDsAyVwEqXsNsFFqBl@oHzF{HlEwG`A_Ac@qL}@gIgCgCiAmCwCyQqDyJaFcLoDyE]mGkBcIu@uCy@eEKeDkCq@iDHkLdBwNfCsJ' +
  '@yCaByCo@aInCiu@aEgQuByEoBmL{CoIkG{DiVgDaPk@ii@b@qE{DyFsV_B{NlAe\\]mQxB}M`HiXzCiR|@eCnDiF`UaStLaA|ZwT|BkcAm@aDV' +
  'oAQiCyAkDoEgBcL}@}@y@yCeGgAoER}EaDeNmEsGsB_G}EuGyFSoGxCeHTwGQqCeBiBwHeA}I]mFFeP}BwPmL_SmGoEoD{A}PTuK|@aIw@eMn@' +
  'oIo@mCiCiI{M}CyBkDgJuCaBoA_BmB_HHoDsBwWiMo\\{CeCkEyFmJaFuIeCcBiA{Io@mNsDkGgCgGmJgEqEcAgCkEyDmE{F}@yB}@u@{Hy@Kg@' +
  '}A`A_AIoEsAcAmAoAWmFf@qInCwHHyCbAs@p@s@|C_AhLiDbLkElFsBvAcC\\sCi@u@sAiCqAmGyFyFiHqBs@wCQ{Gd@mIcAiBeAiDo@wEL{QoA' +
  'eFcDsRv@iEScEaAqPmPmHkWqEsIeHgDsDy@_DG}H`A{FH{Ms@kAJiF|BoDpCoPpDsE\\{Ks@eT|@_AScQnH{BGmD`AcEnEsAbDqFdIiBpHuBxBi' +
  'Dv@kCU_MuDyEc@{UPqDeA_HaFqGgBmGoEqDo@cC?aKsEyA\\}CM}CV_VpI}DfCaHBsKxBwD|AiBvAuB|D_CpI{AtA_HFw`@|EwAl@qIwCgCaCuH' +
  'uIgBoI{EcJeGiGcEaAs@wEsHiJYiFnAaRuBmHaKeIqIkFkEa@aGhAoE`BwC~DgJbWkJpSaHzFcHGuEgCqBgCaB}LFqUu@yIsFoSmCiGoE_DuLT' +
  'wB~AeM|S_AHwFMeGw@gX_QcD_DqCiEuJeTeCaD}c@}_@kkAaxAkgOonS{cGiaIgwOaaTS{@vB{@jCsDzEoAbB_If@oKbBkHfE{EzJgT~Rc[rI{' +
  'JbLoFnFgE`AcGYcBjHcLjH_g@~CwG{@cGnAcGRoFoA{JzEoFzEkCf@kHrIkHnKwGnZ_I{@gJgE_DcG{JSgOfEgERkRz@sIkCoFcLkHoA?gEkC_' +
  'DsDnAgT{@cBkHgEsDcGoAsD~C{Og@wGf@_IfEcBjCSjC{EbBgO~CgEfEcBjHz@nZsNnA{EjC{TzEcGvG_DzJgOz@oUcB{J{EcL?cGz@gJoA{Jr' +
  'SgObV{JvBkHbGgEzEf@fEcBjHwQ~MkH~C{EnFsDfEoFnFsDfEbBvGfEzERfEoAjCcBjCkRSsNkCcV~CkHvLsIbL{JnAoFRwGnAoFfJcBrI?fE{' +
  '@f@kCjCsDjHRzJnAfES~C{E~Hs]z@_I{@cQz@sNdBoF~RwQ`BgE|J{OxEkChHwAlHrAnF{A~JyEpGPhJbFnEQtN}DxBaEtDy@|FPpGsAxFsFrC' +
  '{AlEnHzDx@vEiFdO{a@KmCmIaKsIyTkIgN_EuXeCaJhAiErGkCrBmH_DuQuFoOiB}LuJ_DkDsKeJsa@kBqEt@sFdFuMdAoIuFuScGoHiAkF|@e' +
  'SOsWbA{FlDyErGq@`DkBlC{KbFoEdOaFxG{GjB{Fn@gEtMp@hNyFd[wk@`Q_@pNsMzDkAWiuCZilW]y@SejEhCg_QyA}cHn@uuIWwgRh@odCWq' +
  '_Hd@qtDu@_sMsAqkBB_mSaHsdJb@sqBcCwzALuq@dAk]CihBb@eHe@yFEqR]ykERaaB',
  // zone 4 | zone 5: Monterey, Kings, Tulare, Inyo | San Luis Obispo, Kern, San Bernardino
  'cpnyErkedVxGmoFJocItDgnXbAizP|ByfAJe_CdAcoEr@qfJEwHm@kBxDyjWl@uiAo@i`DfA{sCZosH^ixAd@gABgdEz@agFGi{Q`@oV[yGdCm' +
  'mNh@sxLCsrIz@_{I|AktEh@}zEyAgEh@qyHk@g_Cx@keDdBmmBJgv@aCwv]GmxDt@w}EBe~EcCy|LLy}EzBkfDeDwnWoEufhBP{bPj@ikHEuyK' +
  'hAmhIAqjMr@egHf@mdWaPufS\\spGtIgvG`AumBIof^gAwkIgA}mBM}mBwAaoBEsmBRanBjQsxJdKwvJUe_B}gAxGEe_@TcjP|Aox@J}v@Powa@' +
  'nAA~G}}PVwaGo@udARavGhCooLSe`Gp@ijOk@_wAFsfD_BmmOrAip@{@m{YZoiCY}x\\`@mfPMy|K|Aej\\j@osAfAcrJlAycPvBygK_@qsCr@cg' +
  'Gc@k~@[yyHZquNk@uRC_q@s@qHpAacCq@krZt@{fEo@}kA\\qp@@a|Sw_B]z@wzGwAudDDu_B',
  // zone 5 | zone 6: Los Angeles, San Bernardino | Orange, Riverside
  '_{slExvbpU{xHsmEoJiCiDcD{Wam@|@CqPa^{DkKuC_DuSie@{d@fAiUbGcb@lTuVE{H_Ay^gNknAgq@ud@iHuiAmiAgIsSwDkDIyEyLqZciA\\' +
  '{J_M_FmAgAqGy@aAucAHCeZoUDIcZ}UBM_Zw^TCcZsUDGcZwUJGov@ml@JUwkBkm@PGou@ml@RK}u@ql@N?av@kl@NGcv@gmGQE{bJwH?xCqW[' +
  '?H{CxB_Rt@N@}AAopCdAedBoF{{B|@svJfA_v@xwC{uEj`A_dBjEBlkEykI`i@gg@g@}DiDiBoMgDgFlNsFgAmW}V{LvEkOvPkGDoKlWQggCau' +
  'Bt@kLrAk~Ac@Rsb@ScqF{bHAyfBogImxGMa@amSyBaqBOyaCvAyaBAypCnJ?AoAt@EhC`@Wy@fA}BxXnRvCgHlBsApd@FRwwLpEov@u@s}Cg@B' +
  '`@wRQeRdCcrFbuA_@XavEm@uoHD_VzCqjB_Cmt@s@mv@nBskB{@mwEwC}kBlBodCBkhAiAemAYsiASehHouDf@RkhIXgET_}@y@kiVdBo`Jn@w' +
  'oMvCEeAs{]B}bIpAeoPMs~AsJELumSnCLEyvA}Coh^?_eFoC@EihTYkIMsnE^grP]eGRcdWWg{D~B_ij@~BygJipG][}iPj@uxEkIIiAc_L?ut' +
  'Er@oeJ_@s_EIunZXymLbA}eJ]mtO_AkyFBioT_@euG\\iaC',
];
// Where the zone 5 and 6 line turns south past the coast before it heads west.
const HOOK_5_6 = [[-117.95, 32.4]];
const WEST = -180, EAST = -100;

let lines = null;

/** One encoded polyline (latitude first, 0.00001 degree steps) as [[lon, lat], ...]. */
function decode(s) {
  const out = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let shift = 0, v = 0, b;
    do { b = s.charCodeAt(i++) - 63; v |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    return v & 1 ? ~(v >> 1) : v >> 1;
  };
  while (i < s.length) {
    lat += next(); lon += next();
    out.push([lon / 1e5, lat / 1e5]);
  }
  return out;
}

function zoneLines() {
  if (lines) return lines;
  lines = ZONE_LINES.map((s, k) => {
    const pts = decode(s);
    const west = k === 4 ? [[WEST, HOOK_5_6[0][1]], ...HOOK_5_6] : [[WEST, pts[0][1]]];
    return [...west, ...pts, [EAST, pts[pts.length - 1][1]]];
  });
  return lines;
}

/** Whether (lon, lat) lies south of the line: a ray due north crosses it an odd number of times. */
function southOf(pts, lon, lat) {
  let inside = false;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
    if ((x1 <= lon) !== (x2 <= lon) && y1 + ((lon - x1) * (y2 - y1)) / (x2 - x1) > lat) inside = !inside;
  }
  return inside;
}

/** The CCS83 zone (EPSG 2225 to 2230, US survey feet) of a site in California, by its county (see above). */
export function zoneFor(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('A latitude and longitude in degrees are needed.');
  let zone = 1;
  for (const line of zoneLines()) if (southOf(line, lon, lat)) zone++;
  return 2224 + zone;
}
