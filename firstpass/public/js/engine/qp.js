// Box-constrained quadratic programme with a pentadiagonal symmetric positive definite matrix:
//
//   minimise 0.5 x'Ax + q'x   subject to   lo <= x <= hi,
//
// where A is given by its three diagonals: D0[i] = A[i][i], D1[i] = A[i][i+1], D2[i] = A[i][i+2].
// A variable with lo[i] === hi[i], or with fixed[i] set (it then keeps its starting value), never moves.
//
// Method: projected Newton (Bertsekas 1982). Each iteration finds the variables held at a bound (the
// epsilon-active set with the gradient pointing out of the box), solves the Newton system on the others
// with a banded Cholesky factorisation, and backtracks along the projected path until an Armijo condition
// holds. A x is carried from step to step, so an iteration costs one band product per line search trial.
// Pure arithmetic on typed arrays; a workspace can be reused so a solve makes no garbage.

export function createQPWorkspace(n) {
  return {
    cap: n,
    ax: new Float64Array(n),
    g: new Float64Array(n),
    d: new Float64Array(n),
    xt: new Float64Array(n),
    dx: new Float64Array(n),
    adx: new Float64Array(n),
    il0: new Float64Array(n),
    l1: new Float64Array(n),
    l2: new Float64Array(n),
    y: new Float64Array(n),
    bind: new Uint8Array(n),
    frozen: new Uint8Array(n),
  };
}

/** out = A x for the pentadiagonal A. */
export function bandMul(n, D0, D1, D2, x, out) {
  if (n < 5) {
    for (let i = 0; i < n; i++) {
      let s = D0[i] * x[i];
      if (i + 1 < n) s += D1[i] * x[i + 1];
      if (i + 2 < n) s += D2[i] * x[i + 2];
      if (i >= 1) s += D1[i - 1] * x[i - 1];
      if (i >= 2) s += D2[i - 2] * x[i - 2];
      out[i] = s;
    }
    return;
  }
  out[0] = D0[0] * x[0] + D1[0] * x[1] + D2[0] * x[2];
  out[1] = D1[0] * x[0] + D0[1] * x[1] + D1[1] * x[2] + D2[1] * x[3];
  for (let i = 2; i < n - 2; i++) {
    out[i] = D2[i - 2] * x[i - 2] + D1[i - 1] * x[i - 1] + D0[i] * x[i] + D1[i] * x[i + 1] + D2[i] * x[i + 2];
  }
  const a = n - 2, b = n - 1;
  out[a] = D2[a - 2] * x[a - 2] + D1[a - 1] * x[a - 1] + D0[a] * x[a] + D1[a] * x[b];
  out[b] = D2[b - 2] * x[b - 2] + D1[b - 1] * x[b - 1] + D0[b] * x[b];
}

/** 0.5 x'Ax + q'x, using tmp (length n) as scratch. */
export function qpObjective(prob, x, tmp) {
  const { n, D0, D1, D2, q } = prob;
  const t = tmp || new Float64Array(n);
  bandMul(n, D0, D1, D2, x, t);
  let f = 0;
  for (let i = 0; i < n; i++) f += x[i] * (0.5 * t[i] + q[i]);
  return f;
}

/**
 * Largest violation of the optimality conditions at x: bounds, and the gradient on free variables
 * (it must vanish), at a lower bound (it must not be negative) and at an upper bound (not positive).
 */
export function kktResidual(prob, x, boundTol = 1e-12) {
  const { n, D0, D1, D2, q, lo, hi, fixed } = prob;
  const g = new Float64Array(n);
  bandMul(n, D0, D1, D2, x, g);
  let worst = 0;
  for (let i = 0; i < n; i++) {
    g[i] += q[i];
    const viol = Math.max(lo[i] - x[i], x[i] - hi[i], 0);
    if (viol > worst) worst = viol;
    if ((fixed && fixed[i]) || lo[i] >= hi[i]) continue;
    const span = Math.max(1, Math.abs(lo[i]), Math.abs(hi[i]));
    const atLo = x[i] <= lo[i] + boundTol * span, atHi = x[i] >= hi[i] - boundTol * span;
    let r;
    if (atLo && atHi) r = 0;
    else if (atLo) r = Math.max(0, -g[i]);
    else if (atHi) r = Math.max(0, g[i]);
    else r = Math.abs(g[i]);
    if (r > worst) worst = r;
  }
  return worst;
}

/** out = A x, returning x'out. */
function bandMulDot(n, D0, D1, D2, x, out) {
  bandMul(n, D0, D1, D2, x, out);
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i] * out[i];
  return s;
}

/**
 * Banded Cholesky factor L of A restricted to the free variables (rows of bound variables are identity),
 * fused with the forward solve L y = -g on the free set. Row i of L is (l2[i], l1[i], 1 / il0[i]) in
 * columns i-2, i-1, i. Returns false when A plus the ridge is not positive definite there.
 */
function factorForward(n, D0, D1, D2, ridge, bind, g, il0, l1, l2, y) {
  for (let i = 0; i < n; i++) {
    if (bind[i]) { il0[i] = 1; l1[i] = 0; l2[i] = 0; y[i] = 0; continue; }
    let e2 = 0, e1 = 0, b = -g[i];
    if (i >= 2 && !bind[i - 2]) { e2 = D2[i - 2] * il0[i - 2]; b -= e2 * y[i - 2]; }
    if (i >= 1) {
      e1 = ((bind[i - 1] ? 0 : D1[i - 1]) - e2 * l1[i - 1]) * il0[i - 1];
      b -= e1 * y[i - 1];
    }
    const dg = D0[i] + ridge - e1 * e1 - e2 * e2;
    if (!(dg > 0)) return false;
    const inv = 1 / Math.sqrt(dg);
    l2[i] = e2; l1[i] = e1; il0[i] = inv;
    y[i] = b * inv;
  }
  return true;
}

/**
 * Solve the problem in place: prob.x holds the starting point and receives the answer.
 * prob = { n, D0, D1, D2, q, lo, hi, x, fixed?, tol?, ftol?, maxIter? }
 *   tol    stop when the projected gradient is at most tol * max(1, |q|) (default 1e-10)
 *   ftol   also stop when an iteration lowers the objective by at most ftol * |objective| (default 0, off)
 * Returns { iterations, converged, objective, gradNorm, reason }.
 */
export function solveBoxQP(prob, ws) {
  const { n, D0, D1, D2, q, lo, hi, x } = prob;
  if (!ws || ws.cap < n) ws = createQPWorkspace(n);
  const { ax, g, d, xt, dx, adx, il0, l1, l2, y, bind, frozen } = ws;
  const fixed = prob.fixed;
  const maxIter = prob.maxIter ?? 100;
  const ftol = prob.ftol ?? 0;
  let qmax = 0, amax = 0;
  for (let i = 0; i < n; i++) {
    const aq = q[i] < 0 ? -q[i] : q[i];
    if (aq > qmax) qmax = aq;
    if (D0[i] > amax) amax = D0[i];
  }
  const tol = (prob.tol ?? 1e-10) * Math.max(1, qmax);

  let range = 0;
  for (let i = 0; i < n; i++) {
    const fr = (fixed && fixed[i]) || !(lo[i] < hi[i]);
    frozen[i] = fr ? 1 : 0;
    if (fixed && fixed[i]) continue;
    if (!(lo[i] < hi[i])) { x[i] = lo[i]; continue; }
    if (!(x[i] === x[i])) x[i] = 0.5 * (lo[i] + hi[i]);
    if (x[i] < lo[i]) x[i] = lo[i]; else if (x[i] > hi[i]) x[i] = hi[i];
    const w = hi[i] - lo[i];
    if (w > range && w < Infinity) range = w;
  }
  const epsMax = 1e-3 * Math.max(1, range);

  bandMul(n, D0, D1, D2, x, ax);
  let f = 0;
  for (let i = 0; i < n; i++) f += x[i] * (0.5 * ax[i] + q[i]);

  let iterations = 0, converged = false, gradNorm = Infinity, reason = 'iterations';
  let ridge = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    let pg = 0, wsq = 0;
    for (let i = 0; i < n; i++) {
      const gi = ax[i] + q[i];
      g[i] = gi;
      if (frozen[i]) continue;
      const xi = x[i];
      let v;
      if (xi <= lo[i]) v = gi < 0 ? -gi : 0;
      else if (xi >= hi[i]) v = gi > 0 ? gi : 0;
      else v = gi < 0 ? -gi : gi;
      if (v > pg) pg = v;
      let z = xi - gi;
      if (z < lo[i]) z = lo[i]; else if (z > hi[i]) z = hi[i];
      wsq += (xi - z) * (xi - z);
    }
    gradNorm = pg;
    if (pg <= tol) { converged = true; reason = 'gradient'; break; }
    const eps = Math.min(epsMax, Math.sqrt(wsq));

    // Variables held at a bound this step: within eps of it, with the gradient pointing out of the box.
    for (let i = 0; i < n; i++) {
      bind[i] = frozen[i] || (x[i] <= lo[i] + eps && g[i] > 0) || (x[i] >= hi[i] - eps && g[i] < 0) ? 1 : 0;
    }

    // Newton step on the free set, from a banded Cholesky factorisation of A there (bound rows and
    // columns become identity). A variable sitting on a bound is released when its gradient points into
    // the box; if the Newton step would then push it straight back out, releasing it only makes the
    // iterates zigzag, so it is held after all and the step is solved again.
    let ok = false, held = 0;
    for (let pass = 0; pass < 4; pass++) {
      ok = false;
      for (let attempt = 0; attempt < 6 && !ok; attempt++) {
        ok = factorForward(n, D0, D1, D2, ridge, bind, g, il0, l1, l2, y);
        if (!ok) ridge = ridge > 0 ? ridge * 100 : 1e-12 * Math.max(1, amax);
      }
      if (!ok) break;
      // Back substitution, holding any released variable the step would push out of the box.
      held = 0;
      let d1 = 0, d2 = 0, c1 = 0, c2 = 0;
      for (let i = n - 1; i >= 0; i--) {
        const di = (y[i] - c1 * d1 - c2 * d2) * il0[i];
        d[i] = di;
        c2 = i + 1 < n ? l2[i + 1] : 0;
        c1 = l1[i];
        d2 = d1; d1 = di;
        if (!bind[i] && ((di < 0 && x[i] <= lo[i]) || (di > 0 && x[i] >= hi[i]))) { bind[i] = 1; held++; }
      }
      if (!held) break;
    }
    if (!ok) { reason = 'factorisation'; break; }
    // Variables held at a bound take a diagonally scaled gradient step; the projection keeps them there.
    for (let i = 0; i < n; i++) {
      if (bind[i]) d[i] = frozen[i] ? 0 : -g[i] / D0[i];
    }

    // Projected backtracking line search. f(x + dx) = f + g'dx + 0.5 dx'A dx.
    let alpha = 1, accepted = false, ft = f;
    for (let ls = 0; ls < 30; ls++) {
      let pred = 0, lin = 0;
      for (let i = 0; i < n; i++) {
        let z = x[i] + alpha * d[i];
        if (z < lo[i]) z = lo[i]; else if (z > hi[i]) z = hi[i];
        if (frozen[i]) z = x[i];
        xt[i] = z;
        const s = z - x[i];
        dx[i] = s;
        lin += g[i] * s;
        pred += bind[i] ? -g[i] * s : -alpha * g[i] * d[i];
      }
      const quad = bandMulDot(n, D0, D1, D2, dx, adx);
      ft = f + lin + 0.5 * quad;
      if (f - ft >= 1e-4 * pred && pred >= 0) { accepted = true; break; }
      alpha *= 0.5;
    }
    if (!accepted) { reason = 'no descent'; break; }
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const s = dx[i] < 0 ? -dx[i] : dx[i];
      if (s > moved) moved = s;
      x[i] = xt[i];
      ax[i] += adx[i];
    }
    if (iter % 25 === 24) bandMul(n, D0, D1, D2, x, ax);
    const drop = f - ft;
    f = ft;
    if (moved === 0) { reason = 'no move'; break; }
    if (ftol > 0 && drop <= ftol * Math.abs(f)) { reason = 'objective'; break; }
  }

  // Report the final state honestly, from a fresh product (the carried one drifts by rounding).
  bandMul(n, D0, D1, D2, x, ax);
  let pg = 0;
  f = 0;
  for (let i = 0; i < n; i++) {
    f += x[i] * (0.5 * ax[i] + q[i]);
    if (frozen[i]) continue;
    const gi = ax[i] + q[i];
    let v;
    if (x[i] <= lo[i]) v = gi < 0 ? -gi : 0;
    else if (x[i] >= hi[i]) v = gi > 0 ? gi : 0;
    else v = gi < 0 ? -gi : gi;
    if (v > pg) pg = v;
  }
  gradNorm = pg;
  converged = pg <= tol;
  return { iterations, converged, objective: f, gradNorm, reason };
}
