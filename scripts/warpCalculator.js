/**
 * Star Trek Warp Speed Calculator
 *
 * Formula: v = w^(10/3) * c for warp 1-9
 * For warp > 9: v = w^(10/3 + (w-9)/(10-w)) * c
 * Constants:
 * - Speed of light (c) = 299,792.458 km/s
 * - 1 light-year = 9.461e12 km
 * - 1 day = 86,400 seconds
 */

import { MODULE_ID, t } from "./core/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SPEED_OF_LIGHT_KM_S = 299792.458; // km/s
const SECONDS_PER_DAY = 86400;
const KM_PER_LIGHT_YEAR = 9.461e12;

// Light-years per day at 1c
const LIGHT_YEARS_PER_DAY_AT_C =
  (SPEED_OF_LIGHT_KM_S * SECONDS_PER_DAY) / KM_PER_LIGHT_YEAR;
// ≈ 0.002738 ly/day (about 1 ly per 365.25 days)

// ─────────────────────────────────────────────────────────────────────────────
// TN-2 WARP FACTOR CONVERSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical TNG warp speed lookup table for warp 9+.
 * Format: [warpFactor, speedInC]
 */
const TNG_SPEED_TABLE = [
  [9.0, 1516.38],
  [9.1, 1575.51],
  [9.2, 1640.63],
  [9.3, 1713.31],
  [9.4, 1796.0],
  [9.5, 1894.85],
  [9.6, 2017.93],
  [9.7, 2185.45],
  [9.8, 2450.01],
  [9.9, 3029.26],
  [9.91, 3136.69],
  [9.92, 3264.3],
  [9.93, 3419.44],
  [9.94, 3613.71],
  [9.95, 3866.92],
  [9.96, 4216.18],
  [9.97, 4741.59],
  [9.98, 5660.62],
  [9.99, 7912.0],
];

/**
 * Linearly interpolate speed from the TN-2 lookup table.
 * @param {number} warpFactor - Warp factor between 9.0 and 9.99
 * @returns {number} Speed in multiples of c
 */
function interpolateSpeedAbove9(warpFactor) {
  // Find the bracketing entries
  for (let i = 0; i < TNG_SPEED_TABLE.length - 1; i++) {
    const [w1, s1] = TNG_SPEED_TABLE[i];
    const [w2, s2] = TNG_SPEED_TABLE[i + 1];

    if (warpFactor >= w1 && warpFactor <= w2) {
      // Linear interpolation
      const t = (warpFactor - w1) / (w2 - w1);
      return s1 + t * (s2 - s1);
    }
  }

  // If above 9.99, extrapolate from last two points (approaches infinity)
  const [w1, s1] = TNG_SPEED_TABLE[TNG_SPEED_TABLE.length - 2];
  const [w2, s2] = TNG_SPEED_TABLE[TNG_SPEED_TABLE.length - 1];
  const t = (warpFactor - w1) / (w2 - w1);
  return s1 + t * (s2 - s1);
}

/**
 * Convert warp factor to speed as a multiple of c (speed of light).
 * Uses TNG-era TN-2 formula.
 *
 * For warp 1-9: v = w^(10/3)
 * For warp 9+:  Uses lookup table with linear interpolation for accuracy
 *
 * @param {number} warpFactor - Warp factor (1.0 to 9.99)
 * @returns {number} Speed in multiples of c
 */
export function warpToSpeedMultiplier(warpFactor) {
  if (warpFactor < 1) return warpFactor; // Sublight
  if (warpFactor >= 10) return Infinity; // Warp 10 = infinite velocity

  if (warpFactor <= 9) {
    // Standard TNG formula: w^(10/3)
    return Math.pow(warpFactor, 10 / 3);
  } else {
    // Above warp 9: use lookup table for accuracy
    return interpolateSpeedAbove9(warpFactor);
  }
}

/**
 * Convert speed (multiple of c) back to warp factor using Newton-Raphson iteration.
 * This inverts the TN-2 formula.
 *
 * @param {number} speedMultiplier - Speed in multiples of c
 * @returns {number|null} Warp factor, or null if invalid/unconverged
 */
export function speedMultiplierToWarp(speedMultiplier) {
  if (speedMultiplier <= 0) return null;
  if (speedMultiplier < 1) return speedMultiplier; // Sublight
  if (!isFinite(speedMultiplier)) return 10;

  const maxIterations = 50;
  const tolerance = 1e-9;

  // Function to minimize: f(w) = warpToSpeedMultiplier(w) - target
  const target = speedMultiplier;

  // Initial guess based on inverse of simple formula
  let w = Math.pow(target, 3 / 10);
  if (w > 9.99) w = 9.5; // Start in the correction zone

  for (let i = 0; i < maxIterations; i++) {
    const fw = warpToSpeedMultiplier(w) - target;

    if (Math.abs(fw) < tolerance) {
      return Math.min(Math.max(w, 1), 9.99);
    }

    // Numerical derivative
    const h = 1e-8;
    const fwh = warpToSpeedMultiplier(w + h) - target;
    const derivative = (fwh - fw) / h;

    if (Math.abs(derivative) < 1e-15) break;

    w = w - fw / derivative;

    // Clamp to valid range
    if (w < 1) w = 1;
    if (w > 9.999) w = 9.999;
  }

  // Return best estimate even if not fully converged
  return Math.min(Math.max(w, 1), 9.99);
}

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATION FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate distance traveled given warp factor and time.
 * @param {number} warpFactor - Warp factor (1-9.99)
 * @param {number} timeDays - Time in days
 * @returns {number} Distance in light-years
 */
export function calculateDistance(warpFactor, timeDays) {
  const speedC = warpToSpeedMultiplier(warpFactor);
  const lyPerDay = speedC * LIGHT_YEARS_PER_DAY_AT_C;
  return lyPerDay * timeDays;
}

/**
 * Calculate time required given warp factor and distance.
 * @param {number} warpFactor - Warp factor (1-9.99)
 * @param {number} distanceLY - Distance in light-years
 * @returns {number} Time in days
 */
export function calculateTime(warpFactor, distanceLY) {
  const speedC = warpToSpeedMultiplier(warpFactor);
  const lyPerDay = speedC * LIGHT_YEARS_PER_DAY_AT_C;
  if (lyPerDay <= 0) return Infinity;
  return distanceLY / lyPerDay;
}

/**
 * Calculate warp factor required given distance and time.
 * @param {number} distanceLY - Distance in light-years
 * @param {number} timeDays - Time in days
 * @returns {number|null} Warp factor (1-9.99), or null if impossible
 */
export function calculateWarpFactor(distanceLY, timeDays) {
  if (timeDays <= 0) return null;
  const lyPerDay = distanceLY / timeDays;
  const speedC = lyPerDay / LIGHT_YEARS_PER_DAY_AT_C;
  return speedMultiplierToWarp(speedC);
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTING HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a number with locale-aware formatting.
 * @param {number} value
 * @param {number} decimals
 * @returns {string}
 */
function formatNumber(value, decimals = 2) {
  if (!isFinite(value)) return "∞";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format time in days to a human-readable string (days + hours if applicable).
 * @param {number} days
 * @returns {string}
 */
function formatTime(days) {
  if (!isFinite(days)) return "∞";
  if (days < 1) {
    const hours = days * 24;
    return `${formatNumber(hours, 1)} hours`;
  }
  const wholeDays = Math.floor(days);
  const remainingHours = (days - wholeDays) * 24;
  if (remainingHours < 0.1) {
    return `${formatNumber(wholeDays, 0)} day${wholeDays !== 1 ? "s" : ""}`;
  }
  return `${formatNumber(wholeDays, 0)} day${wholeDays !== 1 ? "s" : ""}, ${formatNumber(remainingHours, 1)} hours`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIALOG UI (ApplicationV2 + HandlebarsApplicationMixin)
// ─────────────────────────────────────────────────────────────────────────────

const Base = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
);

/**
 * Warp Speed Calculator Application.
 * Uses ApplicationV2 for real-time updates as the user types.
 */
class WarpCalculatorApp extends Base {
  constructor({ resolve = null } = {}, options = {}) {
    super(options);
    this._resolve = typeof resolve === "function" ? resolve : null;
    this._resolved = false;
    this._values = { warp: "", distance: "", time: "" };
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-warp-calculator`,
    window: { title: "Warp Speed Calculator" },
    classes: ["sta-officers-log", "sta-warp-calculator-dialog"],
    position: { width: 400, height: "auto" },
    resizable: true,
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/warp-calculator.hbs`,
    },
  };

  async _prepareContext(_options) {
    return {
      instructions: t("sta-officers-log.warpCalculator.instructions"),
      labels: {
        warpFactor: t("sta-officers-log.warpCalculator.warpFactor"),
        distance: t("sta-officers-log.warpCalculator.distance"),
        time: t("sta-officers-log.warpCalculator.time"),
        lightYears: t("sta-officers-log.warpCalculator.lightYears"),
        days: t("sta-officers-log.warpCalculator.days"),
        enterTwoValues: t("sta-officers-log.warpCalculator.enterTwoValues"),
        sendToChat: t("sta-officers-log.warpCalculator.sendToChat"),
        close: t("sta-officers-log.warpCalculator.close"),
      },
      values: this._values,
    };
  }

  _resolveOnce(value) {
    if (this._resolved) return;
    this._resolved = true;
    try {
      this._resolve?.(value);
    } catch (err) {
      console.error(`${MODULE_ID} | WarpCalculatorApp resolve failed`, err);
    }
  }

  async close(options = {}) {
    this._resolveOnce(false);
    return super.close(options);
  }

  _attachPartListeners(partId, htmlElement, _options) {
    super._attachPartListeners?.(partId, htmlElement, _options);
    if (partId !== "main") return;

    const root = htmlElement;
    if (!root) return;

    // Prevent duplicate bindings on re-render
    if (root.dataset.staWarpCalcBound === "1") return;
    root.dataset.staWarpCalcBound = "1";

    const warpInput = root.querySelector('input[name="warp"]');
    const distanceInput = root.querySelector('input[name="distance"]');
    const timeInput = root.querySelector('input[name="time"]');
    const resultsDiv = root.querySelector('[data-hook="results"]');
    const sendButton = root.querySelector('button[data-action="send"]');
    const closeButton = root.querySelector('button[data-action="close"]');

    const updateCalculation = () => {
      const warp = parseFloat(warpInput?.value) || null;
      const distance = parseFloat(distanceInput?.value) || null;
      const time = parseFloat(timeInput?.value) || null;

      // Store values for potential re-render
      this._values = {
        warp: warpInput?.value ?? "",
        distance: distanceInput?.value ?? "",
        time: timeInput?.value ?? "",
      };

      const result = computeResults(warp, distance, time);
      if (resultsDiv) resultsDiv.innerHTML = result.html;
      if (sendButton) sendButton.disabled = !result.valid;
    };

    // Bind input events for real-time updates
    warpInput?.addEventListener("input", updateCalculation);
    distanceInput?.addEventListener("input", updateCalculation);
    timeInput?.addEventListener("input", updateCalculation);

    // Handle button clicks
    sendButton?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const resultsHtml = resultsDiv?.innerHTML ?? "";
      sendResultsToChat(resultsHtml);
      this._resolveOnce(true);
      await this.close();
    });

    closeButton?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      this._resolveOnce(false);
      await this.close();
    });

    // Initial calculation
    updateCalculation();
  }
}

/**
 * Open the Warp Speed Calculator dialog.
 * Allows inputting any two values to calculate the third.
 * Results update in real-time as values change.
 *
 * @returns {Promise<boolean>} True if sent to chat, false if closed
 */
export async function openWarpCalculator() {
  return new Promise((resolve) => {
    const app = new WarpCalculatorApp({ resolve });
    app.render(true);
  });
}

/**
 * Compute results based on which two values are provided.
 * @param {number|null} warp
 * @param {number|null} distance
 * @param {number|null} time
 * @returns {{html: string, valid: boolean}}
 */
function computeResults(warp, distance, time) {
  const hasWarp = warp !== null && warp >= 1 && warp <= 9.99;
  const hasDistance = distance !== null && distance > 0;
  const hasTime = time !== null && time > 0;

  const filledCount = [hasWarp, hasDistance, hasTime].filter(Boolean).length;

  if (filledCount < 2) {
    return {
      html: `<div class="sta-warp-result-placeholder">${t("sta-officers-log.warpCalculator.enterTwoValues")}</div>`,
      valid: false,
    };
  }

  let calculatedWarp = warp;
  let calculatedDistance = distance;
  let calculatedTime = time;
  let solveMode = "";

  if (hasWarp && hasTime && !hasDistance) {
    // Calculate distance
    calculatedDistance = calculateDistance(warp, time);
    solveMode = "distance";
  } else if (hasWarp && hasDistance && !hasTime) {
    // Calculate time
    calculatedTime = calculateTime(warp, distance);
    solveMode = "time";
  } else if (hasDistance && hasTime && !hasWarp) {
    // Calculate warp factor
    calculatedWarp = calculateWarpFactor(distance, time);
    solveMode = "warp";
  } else {
    // All three provided - show what they entered, highlight any inconsistency
    solveMode = "verify";
  }

  if (calculatedWarp === null || !isFinite(calculatedWarp)) {
    return {
      html: `<div class="sta-warp-result-error">${t("sta-officers-log.warpCalculator.cannotCalculate")}</div>`,
      valid: false,
    };
  }

  const speedC = warpToSpeedMultiplier(calculatedWarp);
  const lyPerDay = speedC * LIGHT_YEARS_PER_DAY_AT_C;

  const warpDisplay = formatNumber(calculatedWarp, 2);
  const distanceDisplay = formatNumber(calculatedDistance, 2);
  const timeDisplay = formatTime(calculatedTime);
  const speedDisplay = formatNumber(speedC, 2);
  const lyPerDayDisplay = formatNumber(lyPerDay, 4);

  const highlightClass = (field) =>
    field === solveMode ? "sta-warp-calculated" : "";

  const html = `
    <div class="sta-warp-results-grid">
      <div class="sta-warp-result-row ${highlightClass("warp")}">
        <span class="sta-warp-result-label">${t("sta-officers-log.warpCalculator.warpFactor")}:</span>
        <span class="sta-warp-result-value">${warpDisplay}</span>
      </div>
      <div class="sta-warp-result-row ${highlightClass("distance")}">
        <span class="sta-warp-result-label">${t("sta-officers-log.warpCalculator.distance")}:</span>
        <span class="sta-warp-result-value">${distanceDisplay} ${t("sta-officers-log.warpCalculator.ly")}</span>
      </div>
      <div class="sta-warp-result-row ${highlightClass("time")}">
        <span class="sta-warp-result-label">${t("sta-officers-log.warpCalculator.time")}:</span>
        <span class="sta-warp-result-value">${timeDisplay}</span>
      </div>
      <hr class="sta-warp-divider" />
      <div class="sta-warp-result-row sta-warp-derived">
        <span class="sta-warp-result-label">${t("sta-officers-log.warpCalculator.lyPerDay")}:</span>
        <span class="sta-warp-result-value">${lyPerDayDisplay} ${t("sta-officers-log.warpCalculator.lyDay")}</span>
      </div>
    </div>
  `;

  return { html, valid: true };
}

/**
 * Send the calculated results to chat.
 * @param {string} resultsHtml - The HTML content of the results
 */
function sendResultsToChat(resultsHtml) {
  const content = `
    <div class="sta-warp-calculator-chat">
      <h3><i class="fas fa-rocket"></i> ${t("sta-officers-log.warpCalculator.title")}</h3>
      ${resultsHtml}
    </div>
  `;

  ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS FOR API
// ─────────────────────────────────────────────────────────────────────────────

export const warpCalculator = {
  open: openWarpCalculator,
  warpToSpeedMultiplier,
  speedMultiplierToWarp,
  calculateDistance,
  calculateTime,
  calculateWarpFactor,
};
