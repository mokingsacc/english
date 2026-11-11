import test from 'node:test';
import assert from 'node:assert/strict';
import { solveBoxQP, kktResidual, qpObjective, createQPWorkspace, bandMul } from '../../public/js/engine/qp.js';
import { rng } from './helpers.mjs';

// A random pentadiagonal symmetric positive definite problem: A = B'B + delta I with B lower triangular of
// bandwidth 2, so A has bandwidth 2. Bounds are random boxes, some of them tight, some infinite on one side.
function randomProblem(n, rand, opts = {}) {
  const b0 = [], b1 = [], b2 = [];
  for (let i = 0; i < n; i++) { b0.push(0.2 + rand() * 2); b1.push(rand() * 2 - 1); b2.push(rand() * 2 - 1); }
  // B[i][i] = b0[i], B[i][i-1] = b1[i], B[i][i-2] = b2[i]
  const dense = Array.from({ length: n }, () => new Float64Array(n));
  const B = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) { B[i][i] = b0[i]; if (i >= 1) B[i][i - 1] = b1[i]; if (i >= 2) B[i][i - 2] = b2[i]; }
  const delta = opts.delta ?? 1e-3;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += B[k][i] * B[k][j];
    dense[i][j] = s + (i === j ? delta : 0);
  }
  const D0 = new Float64Array(n), D1 = new Float64Array(n), D2 = new Float64Array(n);
  for (let i = 0; i < n; i++) { D0[i] = dense[i][i]; if (i + 1 < n) D1[i] = dense[i][i + 1]; if (i + 2 < n) D2[i] = dense[i][i + 2]; }
  const q = new Float64Array(n), lo = new Float64Array(n), hi = new Float64Array(n), x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    q[i] = (rand() * 2 - 1) * 5;
    const c = rand() * 2 - 1, w = rand() * 2;
    lo[i] = c - w; hi[i] = c + w;
    const r = rand();
    if (r < 0.1) lo[i] = -Infinity; else if (r < 0.2) hi[i] = Infinity; else if (r < 0.25) { lo[i] = c; hi[i] = c; }
    x[i] = 0;
  }
  return { n, D0, D1, D2, q, lo, hi, x, dense };
}

// Exact answer by trying every assignment of each variable to free, its lower bound or its upper bound:
// solve the free part densely, keep the feasible assignments that satisfy the optimality conditions, and
// return the one with the smallest objective. Only for small n (3 to the n assignments).
function referenceSolve(P, fixedVals) {
  const { n, dense, q, lo, hi } = P;
  let best = null;
  const state = new Array(n).fill(0);
  const total = 3 ** n;
  for (let code = 0; code < total; code++) {
    let c = code, skip = false;
    for (let i = 0; i < n; i++) { state[i] = c % 3; c = Math.floor(c / 3); }
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (fixedVals && fixedVals[i] !== undefined) { if (state[i] !== 1) skip = true; x[i] = fixedVals[i]; continue; }
      if (state[i] === 1) { if (!Number.isFinite(lo[i])) skip = true; x[i] = lo[i]; }
      if (state[i] === 2) { if (!Number.isFinite(hi[i])) skip = true; x[i] = hi[i]; }
    }
    if (skip) continue;
    const free = [];
    for (let i = 0; i < n; i++) if (state[i] === 0) free.push(i);
    if (free.length) {
      // A_FF x_F = -(q_F + A_FB x_B)
      const m = free.length;
      const M = free.map((i) => free.map((j) => dense[i][j]));
      const rhs = free.map((i) => {
        let s = -q[i];
        for (let j = 0; j < n; j++) if (state[j] !== 0) s -= dense[i][j] * x[j];
        return s;
      });
      const sol = gauss(M, rhs, m);
      free.forEach((i, k) => { x[i] = sol[k]; });
    }
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      if (x[i] < lo[i] - 1e-9 || x[i] > hi[i] + 1e-9) ok = false;
    }
    if (!ok) continue;
    const f = objectiveDense(P, x);
    if (!best || f < best.f - 1e-12) best = { f, x };
  }
  return best;
}

function gauss(M, b, m) {
  const A = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < m; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k];
    }
  }
  const x = new Array(m).fill(0);
  for (let r = m - 1; r >= 0; r--) {
    let s = A[r][m];
    for (let k = r + 1; k < m; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

function objectiveDense(P, x) {
  let f = 0;
  for (let i = 0; i < P.n; i++) {
    let ax = 0;
    for (let j = 0; j < P.n; j++) ax += P.dense[i][j] * x[j];
    f += x[i] * (0.5 * ax + P.q[i]);
  }
  return f;
}

// Slow but simple reference for larger problems: projected coordinate descent (Gauss-Seidel with
// clamping), run until nothing moves. It converges to the minimiser for a positive definite matrix.
function coordinateDescent(P) {
  const { n, dense, q, lo, hi } = P;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.min(hi[i], Math.max(lo[i], 0));
  for (let sweep = 0; sweep < 200000; sweep++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let g = q[i];
      for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) g += dense[i][j] * x[j];
      let z = x[i] - g / dense[i][i];
      if (z < lo[i]) z = lo[i]; else if (z > hi[i]) z = hi[i];
      moved = Math.max(moved, Math.abs(z - x[i]));
      x[i] = z;
    }
    if (moved < 1e-14) break;
  }
  return x;
}

test('the band product matches the dense product', () => {
  const rand = rng(1);
  for (const n of [1, 2, 3, 4, 5, 6, 9]) {
    const P = randomProblem(n, rand);
    const x = Float64Array.from({ length: n }, () => rand() - 0.5);
    const out = new Float64Array(n);
    bandMul(n, P.D0, P.D1, P.D2, x, out);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += P.dense[i][j] * x[j];
      assert.ok(Math.abs(s - out[i]) < 1e-12, `row ${i} of ${n}`);
    }
  }
});

test('small random problems agree with the exact reference solver', () => {
  const rand = rng(7);
  let tried = 0;
  for (let trial = 0; trial < 300; trial++) {
    const n = 1 + (trial % 7);
    const P = randomProblem(n, rand);
    const ref = referenceSolve(P);
    if (!ref) continue; // no finite answer (an unbounded side that the objective runs along); cannot happen for SPD, kept as a guard
    tried++;
    const r = solveBoxQP({ ...P, tol: 1e-12 });
    assert.ok(r.converged, `trial ${trial}: ${r.reason}`);
    for (let i = 0; i < n; i++) assert.ok(Math.abs(P.x[i] - ref.x[i]) < 1e-6, `trial ${trial} n ${n} x[${i}] ${P.x[i]} against ${ref.x[i]}`);
    assert.ok(Math.abs(qpObjective(P, P.x) - ref.f) < 1e-8 * Math.max(1, Math.abs(ref.f)));
  }
  assert.ok(tried > 250);
});

test('larger random problems agree with coordinate descent and pass the optimality check', () => {
  const rand = rng(11);
  for (const n of [12, 25, 60]) {
    for (let trial = 0; trial < 4; trial++) {
      const P = randomProblem(n, rand, { delta: 0.05 });
      const ref = coordinateDescent(P);
      const ws = createQPWorkspace(n);
      const r = solveBoxQP({ ...P, tol: 1e-12, maxIter: 500 }, ws);
      assert.ok(r.converged, `n ${n} trial ${trial}: ${r.reason}`);
      for (let i = 0; i < n; i++) assert.ok(Math.abs(P.x[i] - ref[i]) < 1e-6, `n ${n} x[${i}]`);
      assert.ok(kktResidual(P, P.x, 1e-12) < 1e-8, `KKT ${kktResidual(P, P.x)}`);
    }
  }
});

test('the optimality residual is small on long ill-conditioned problems like the fastest path ones', () => {
  // Second-difference energy with a tiny ridge: the same structure as the racing line problem.
  const rand = rng(3);
  const n = 300;
  const D0 = new Float64Array(n), D1 = new Float64Array(n), D2 = new Float64Array(n), q = new Float64Array(n);
  for (let k = 1; k < n - 1; k++) {
    D0[k - 1] += 1; D0[k] += 4; D0[k + 1] += 1;
    D1[k - 1] += -2; D1[k] += -2; D2[k - 1] += 1;
  }
  for (let k = 0; k < n; k++) { D0[k] += 1e-9; q[k] = Math.sin(k / 15) * 0.05; }
  const lo = new Float64Array(n), hi = new Float64Array(n), x = new Float64Array(n);
  for (let k = 0; k < n; k++) { lo[k] = -3 - rand(); hi[k] = 3 + rand(); }
  lo[0] = hi[0] = 1; lo[1] = hi[1] = 1; lo[n - 1] = hi[n - 1] = -1; lo[n - 2] = hi[n - 2] = -1;
  const P = { n, D0, D1, D2, q, lo, hi, x, tol: 1e-10, maxIter: 400 };
  const r = solveBoxQP(P);
  assert.ok(r.converged, r.reason);
  assert.ok(kktResidual(P, x, 1e-10) < 1e-8);
});

test('fixed variables keep their value and the rest is optimal around them', () => {
  const rand = rng(21);
  for (let trial = 0; trial < 60; trial++) {
    const n = 2 + (trial % 5);
    const P = randomProblem(n, rand);
    const fixed = new Uint8Array(n);
    const fixedVals = {};
    const k = trial % n;
    fixed[k] = 1;
    P.x[k] = Number.isFinite(P.lo[k]) ? P.lo[k] : 0.3;
    fixedVals[k] = P.x[k];
    const ref = referenceSolve(P, fixedVals);
    const r = solveBoxQP({ ...P, fixed, tol: 1e-12 });
    assert.equal(P.x[k], fixedVals[k]);
    assert.ok(r.converged);
    for (let i = 0; i < n; i++) assert.ok(Math.abs(P.x[i] - ref.x[i]) < 1e-6, `trial ${trial} x[${i}]`);
  }
});

test('equal bounds pin a variable and a start outside the box is pulled in', () => {
  const n = 5;
  const P = {
    n, D0: Float64Array.of(2, 2, 2, 2, 2), D1: Float64Array.of(-1, -1, -1, -1, 0), D2: new Float64Array(n),
    q: Float64Array.of(-1, 0, 0, 0, -1), lo: Float64Array.of(0.5, -1, -1, -1, -1), hi: Float64Array.of(0.5, 1, 1, 0.2, 1),
    x: Float64Array.of(9, 9, -9, 9, 9),
  };
  const r = solveBoxQP(P);
  assert.ok(r.converged);
  assert.equal(P.x[0], 0.5);
  for (let i = 0; i < n; i++) assert.ok(P.x[i] >= P.lo[i] && P.x[i] <= P.hi[i]);
  assert.ok(kktResidual(P, P.x) < 1e-9);
});

test('a workspace can be reused for problems of different sizes', () => {
  const rand = rng(5);
  const ws = createQPWorkspace(40);
  for (const n of [40, 7, 33, 2, 40]) {
    const P = randomProblem(n, rand, { delta: 0.05 });
    const ref = coordinateDescent(P);
    solveBoxQP({ ...P, tol: 1e-12, maxIter: 500 }, ws);
    for (let i = 0; i < n; i++) assert.ok(Math.abs(P.x[i] - ref[i]) < 1e-6);
  }
});
