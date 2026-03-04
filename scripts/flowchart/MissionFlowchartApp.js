/**
 * Mission Flowchart Application
 *
 * ApplicationV2 dialog that displays an interactive flowchart visualization
 * of mission logs and callback chains. Users can view, create, and manage
 * callback links between logs visually.
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import {
  getValueItems,
  getValueStateArray,
  isValueInvokedState,
} from "../values/values.js";
import {
  getPrimaryValueIdForLog,
  getMilestoneChildLogIds,
} from "../log/logMetadata.js";
import { openNewMilestoneArcDialog } from "../milestones/newMilestoneArcDialog.js";
import { getCreatedKey, compareKeys } from "../log/sortingUtils.js";

const Base = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
);

/**
 * @typedef {object} FlowchartNode
 * @property {string} id - Log item ID
 * @property {string} name - Log name
 * @property {string} primaryValueId - Primary value ID for outline color
 * @property {string[]} valueIds - All value IDs used in this log (for pie fill)
 * @property {boolean} isArcEnd - Whether this log ends a completed arc
 * @property {string|null} arcId - Arc identifier if part of completed arc
 * @property {number} x - X position (computed during layout)
 * @property {number} y - Y position (computed during layout)
 */

/**
 * @typedef {object} FlowchartEdge
 * @property {string} fromLogId - Source log ID (callback target)
 * @property {string} toLogId - Destination log ID (log making callback)
 * @property {string} valueId - Value used for this callback
 */

/**
 * @typedef {object} FlowchartArc
 * @property {string} id - Arc identifier (arcEnd log ID)
 * @property {string} valueId - Value ID for this arc
 * @property {string[]} logIds - Log IDs in this arc chain
 * @property {number} colorIndex - Color index for rendering
 */

export class MissionFlowchartApp extends Base {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;

    // Data state
    this._nodes = [];
    this._edges = [];
    this._arcs = [];
    this._valueColors = new Map();

    // PixiJS state
    this._pixiApp = null;
    this._viewport = null;
    this._layers = {
      slots: null, // Empty slot indicators
      arcs: null,
      edges: null,
      nodes: null,
      labels: null,
      headers: null, // Column headers
    };
    this._nodeSprites = new Map(); // nodeId -> PIXI.Container
    this._arcBoxSprites = new Map(); // arcId -> PIXI.Graphics
    this._slots = []; // Array of {x, y, arcId, slotIndex, occupied} for snap targets
    this._arcColumns = []; // Array of {arcId, x, valueName, color} for column headers
    this._stagingX = 0; // X position of staging area

    // Interaction state
    this._selectedNodeId = null;
    this._selectedNodeIds = new Set(); // Multi-selection
    this._dragState = null;
    this._arcDragState = null; // For dragging entire arc boxes
    this._selectionBoxState = null; // For selection box dragging
    this._activeLabel = null; // Currently shown hover label
    this._activeMilestoneLabel = null; // Currently shown milestone hover label
    this._chainPreviewContainer = null; // Preview slots for incomplete chains

    // Resize observer
    this._resizeObserver = null;

    // Hook IDs for cleanup
    this._hookIds = [];

    // Dirty tracking for unsaved position changes
    this._isDirty = false;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-flowchart`,
    window: {
      title: "Mission Log Flowchart",
      resizable: true,
    },
    classes: ["sta-officers-log", "sta-flowchart-window"],
    position: { width: 900, height: 650 },
    actions: {
      "add-log": function () {
        this._createNewLog();
      },
      "reset-layout": function () {
        this._resetLayout();
      },
      "zoom-in": function () {
        this._zoomViewport(1.2);
      },
      "zoom-out": function () {
        this._zoomViewport(1 / 1.2);
      },
      "fit-view": function () {
        this._fitViewport();
      },
      "save-positions": function () {
        this._savePositions();
      },
      "open-log": function (event, target) {
        const nodeId = target.dataset.nodeId;
        if (nodeId) {
          const log = this.actor?.items.get(nodeId);
          log?.sheet?.render(true);
        }
      },
      "delete-log": function (event, target) {
        const nodeId = target.dataset.nodeId;
        if (nodeId) this._confirmDeleteLog(nodeId);
      },
      "clear-callback": function (event, target) {
        const nodeId = target.dataset.nodeId;
        if (nodeId) this._clearCallbackLink(nodeId);
      },
      "toggle-advanced": function (event, target) {
        this._toggleAdvancedSidebar(target);
      },
    },
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/flowchart.hbs`,
    },
  };

  get title() {
    const actorName = this.actor?.name ?? "";
    const base =
      t("sta-officers-log.flowchart.title") ?? "Mission Log Flowchart";
    return actorName ? `${base}: ${actorName}` : base;
  }

  /**
   * Build flowchart data from actor's logs.
   */
  _buildFlowchartData() {
    const actor = this.actor;
    if (!actor) return { nodes: [], edges: [], arcs: [], values: [] };

    const logs = actor.items.filter((i) => i.type === "log");
    const valueItems = getValueItems(actor);

    // Build value color mapping (index-based)
    this._valueColors.clear();
    valueItems.forEach((v, index) => {
      this._valueColors.set(v.id, index);
    });

    // Identify completed arcs
    const arcEndLogs = new Map(); // logId -> arcInfo
    const arcLogSets = new Map(); // arcEndId -> Set of logIds in arc
    for (const log of logs) {
      const arcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
      if (arcInfo?.isArc === true) {
        arcEndLogs.set(log.id, arcInfo);
        const chainIds = Array.isArray(arcInfo.chainLogIds)
          ? arcInfo.chainLogIds
          : [];
        arcLogSets.set(log.id, new Set(chainIds));
      }
    }

    // Build nodes
    /** @type {FlowchartNode[]} */
    const nodes = [];
    for (const log of logs) {
      const primaryValueId = getPrimaryValueIdForLog(actor, log, valueItems);

      // Get all value IDs with invoked states for pie-chart
      const invokedValueIds = [];
      for (const v of valueItems) {
        const stateArr = getValueStateArray(log, v.id);
        const hasInvoked = stateArr.some(isValueInvokedState);
        if (hasInvoked) invokedValueIds.push(v.id);
      }

      // Determine if this log is part of/ends an arc
      let isArcEnd = arcEndLogs.has(log.id);
      let arcId = null;
      for (const [arcEndId, logSet] of arcLogSets.entries()) {
        if (logSet.has(log.id)) {
          arcId = arcEndId;
          break;
        }
      }

      // Load saved position if available
      const savedPos = log.getFlag?.(MODULE_ID, "flowchartPosition") ?? null;

      nodes.push({
        id: log.id,
        name: log.name,
        primaryValueId,
        valueIds:
          invokedValueIds.length > 0
            ? invokedValueIds
            : [primaryValueId].filter(Boolean),
        isArcEnd,
        arcId,
        isUsed: Boolean(log?.system?.used),
        x: savedPos?.x ?? 0,
        y: savedPos?.y ?? 0,
        hasSavedPosition: Boolean(savedPos),
      });
    }

    // Build edges from callback links
    /** @type {FlowchartEdge[]} */
    const edges = [];

    // Build a map of callback links to milestones
    // Key: "fromLogId:toLogId", Value: { name, isArc }
    const milestones = actor.items.filter((i) => i?.type === "milestone");
    const callbackToMilestone = new Map();
    for (const ms of milestones) {
      const isArc = !!ms.system?.arc?.isArc;
      const childIds = isArc
        ? getMilestoneChildLogIds(ms)
        : [
            String(ms.system?.childA ?? ""),
            String(ms.system?.childB ?? ""),
          ].filter(Boolean);

      if (isArc) {
        // For arcs, only show milestone on the FINAL edge (where toLogId is the arc-ending node)
        if (childIds.length >= 2) {
          const lastIdx = childIds.length - 1;
          const key = `${childIds[lastIdx - 1]}:${childIds[lastIdx]}`;
          callbackToMilestone.set(key, {
            id: ms.id,
            name: ms.name,
            isArc,
          });
        }
      } else {
        // For non-arc milestones, map the single edge
        for (let i = 0; i < childIds.length - 1; i++) {
          const key = `${childIds[i]}:${childIds[i + 1]}`;
          callbackToMilestone.set(key, {
            id: ms.id,
            name: ms.name,
            isArc,
          });
        }
      }
    }

    for (const log of logs) {
      const link = log.getFlag?.(MODULE_ID, "callbackLink") ?? null;
      if (!link?.fromLogId) continue;

      // Look up milestone info for this callback
      const msKey = `${link.fromLogId}:${log.id}`;
      const msInfo = callbackToMilestone.get(msKey) ?? null;

      edges.push({
        fromLogId: link.fromLogId,
        toLogId: log.id,
        valueId: link.valueId ?? "",
        milestoneName: msInfo?.name ?? null,
        milestoneIsArc: msInfo?.isArc ?? false,
      });
    }

    // Build arc data for rendering arc boxes
    /** @type {FlowchartArc[]} */
    const arcs = [];
    for (const [arcEndId, arcInfo] of arcEndLogs.entries()) {
      const chainIds = Array.isArray(arcInfo.chainLogIds)
        ? arcInfo.chainLogIds
        : [];
      const colorIndex = this._valueColors.get(arcInfo.valueId) ?? 0;
      const steps = Number(arcInfo.steps) || chainIds.length || 3;
      arcs.push({
        id: arcEndId,
        valueId: arcInfo.valueId ?? "",
        arcLabel: arcInfo.arcLabel ?? "",
        logIds: chainIds,
        steps,
        colorIndex,
      });
    }

    // Sort nodes by creation time (oldest first for vertical layout)
    nodes.sort((a, b) => {
      const logA = actor.items.get(a.id);
      const logB = actor.items.get(b.id);
      return compareKeys(getCreatedKey(logA), getCreatedKey(logB));
    });

    return {
      nodes,
      edges,
      arcs,
      values: valueItems.map((v, i) => ({
        id: v.id,
        name: v.name,
        colorIndex: i,
      })),
    };
  }

  async _prepareContext(_options) {
    const { nodes, edges, arcs, values } = this._buildFlowchartData();

    this._nodes = nodes;
    this._edges = edges;
    this._arcs = arcs;

    return {
      actorId: this.actor?.id ?? "",
      actorName: this.actor?.name ?? "",
      nodeCount: nodes.length,
      edgeCount: edges.length,
      arcCount: arcs.length,
      values,
      hasLogs: nodes.length > 0,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    const root = this.element;
    if (!root) {
      console.warn(`${MODULE_ID} | Flowchart: No root element found`);
      return;
    }

    // Prevent duplicate bindings
    if (root.dataset.staFlowchartBound === "1") return;
    root.dataset.staFlowchartBound = "1";

    // Initialize PixiJS in the canvas container
    // Delay to ensure DOM is fully laid out and has dimensions
    const canvasContainer = root.querySelector(
      ".sta-flowchart-canvas-container",
    );

    if (canvasContainer && this._nodes.length > 0) {
      // Use requestAnimationFrame to ensure layout is complete
      requestAnimationFrame(() => {
        this._initPixiApp(canvasContainer);
      });
    }

    // Register hooks for live updates
    this._registerUpdateHooks();
  }

  /**
   * Initialize the PixiJS application.
   */
  _initPixiApp(container) {
    // Clean up existing app if any
    if (this._pixiApp) {
      this._pixiApp.destroy(true, { children: true });
      this._pixiApp = null;
    }

    const rect = container.getBoundingClientRect();

    // Check if we have valid dimensions
    if (rect.width <= 0 || rect.height <= 0) {
      console.warn(`${MODULE_ID} | Flowchart: Canvas container has no size`);
      return;
    }

    // Check if PIXI is available
    if (typeof PIXI === "undefined") {
      console.error(`${MODULE_ID} | Flowchart: PIXI is not available`);
      return;
    }

    // Create PixiJS Application (PIXI v7 synchronous API used by Foundry)
    this._pixiApp = new PIXI.Application({
      width: rect.width,
      height: rect.height,
      backgroundColor: 0x1a1a2e,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // Remove existing canvas if present
    const existingCanvas = container.querySelector("canvas");
    if (existingCanvas) existingCanvas.remove();

    // Add canvas to container (PIXI v7 uses 'view' not 'canvas')
    container.appendChild(this._pixiApp.view);
    this._pixiApp.view.classList.add("sta-flowchart-canvas");

    // Prevent context menu on right-click (used for link creation)
    this._pixiApp.view.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    // Create viewport for pan/zoom
    this._viewport = new PIXI.Container();
    this._pixiApp.stage.addChild(this._viewport);

    // Create layers (order matters - first added is at bottom)
    this._layers.slots = new PIXI.Container(); // Empty slot indicators (bottom)
    this._layers.arcs = new PIXI.Container();
    this._layers.edges = new PIXI.Container();
    this._layers.nodes = new PIXI.Container();
    this._layers.labels = new PIXI.Container();
    this._layers.dragLine = new PIXI.Container();
    this._layers.headers = new PIXI.Container(); // Column headers (top)
    this._layers.selection = new PIXI.Container(); // Selection box (topmost)

    this._viewport.addChild(this._layers.slots);
    this._viewport.addChild(this._layers.arcs);
    this._viewport.addChild(this._layers.edges);
    this._viewport.addChild(this._layers.nodes);
    this._viewport.addChild(this._layers.labels);
    this._viewport.addChild(this._layers.dragLine);
    this._viewport.addChild(this._layers.headers);
    this._viewport.addChild(this._layers.selection);

    // Enable interactivity on stage
    this._pixiApp.stage.eventMode = "static";
    this._pixiApp.stage.hitArea = this._pixiApp.screen;

    // Compute layout and render the flowchart
    this._computeLayout();
    this._renderFlowchart();

    // Setup pan/zoom interactions
    this._setupViewportInteractions();

    // Setup resize observer for responsive canvas
    this._setupResizeObserver(container);
  }

  /**
   * Setup resize observer to dynamically resize the canvas.
   */
  _setupResizeObserver(container) {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }

    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && this._pixiApp?.renderer) {
          this._pixiApp.renderer.resize(width, height);
          // Update stage hit area to match new size
          this._pixiApp.stage.hitArea = this._pixiApp.screen;
        }
      }
    });

    this._resizeObserver.observe(container);
  }

  /**
   * Compute node positions using a vertical timeline layout.
   * - Linked nodes (connected by callbacks) share a column and stack vertically
   * - Unlinked nodes each get their own column
   * - Within each column, nodes are sorted chronologically (oldest at top)
  /**
   * Compute node positions using arc-based slot columns.
   * - Each completed arc gets a column with N slots (where N = arc steps)
   * - Nodes in completed arcs are placed in their arc's slots
   * - Unassigned nodes appear in a staging area to the right
   * @param {Object} options - Layout options
   * @param {boolean} options.ignoreSavedPositions - If true, ignore saved positions
   */
  _computeLayout({ ignoreSavedPositions = false } = {}) {
    const nodeRadius = 24;
    const verticalSpacing = 80;
    const horizontalSpacing = 160;
    const startX = 120;
    const startY = 100;

    if (this._nodes.length === 0) return;

    // Clear slots and arc columns
    this._slots = [];
    this._arcColumns = [];

    // Helper to get sort key for a node (date-based)
    const getSortKey = (nodeId) => {
      const log = this.actor?.items.get(nodeId);
      return getCreatedKey(log);
    };

    // Track which nodes are assigned to arcs
    const assignedNodeIds = new Set();

    // Sort arcs by the date of their oldest log (left to right = oldest first)
    const sortedArcs = [...this._arcs].sort((a, b) => {
      // Find the oldest log in each arc by checking all chain members
      const aKeys = a.logIds.map((id) => getSortKey(id));
      const bKeys = b.logIds.map((id) => getSortKey(id));
      aKeys.sort(compareKeys);
      bKeys.sort(compareKeys);
      const aOldest = aKeys[0] ?? getCreatedKey(null);
      const bOldest = bKeys[0] ?? getCreatedKey(null);
      return compareKeys(aOldest, bOldest);
    });

    // Create arc columns with slots
    let colIndex = 0;
    for (const arc of sortedArcs) {
      const defaultColX = startX + colIndex * horizontalSpacing;
      const slotCount = arc.steps || arc.logIds.length || 3;

      // Get the column header: prefer arcLabel, fall back to value name
      const valueItem = this.actor?.items?.get(arc.valueId);
      const valueName =
        arc.arcLabel ||
        valueItem?.name ||
        game.i18n.localize("sta-officers-log.flowchart.arcColumn");

      // Load saved column position if available
      const arcLog = this.actor?.items?.get(arc.id);
      const savedColPos = ignoreSavedPositions
        ? null
        : (arcLog?.getFlag?.(MODULE_ID, "flowchartColumnPosition") ?? null);

      // Store arc column metadata for headers
      this._arcColumns.push({
        arcId: arc.id,
        x: savedColPos?.x ?? defaultColX,
        y: savedColPos?.y ?? startY - 60, // Position header above first slot
        valueName: valueName,
        color: this._getColorForIndex(arc.colorIndex),
        slotCount: slotCount,
      });

      // Sort arc's logIds by callback chain order (root at top, arc-end at bottom)
      // Build a map: who calls back to whom
      const callsBackTo = new Map(); // nodeId -> targetId (the log it calls back to)
      for (const logId of arc.logIds) {
        const edge = this._edges.find((e) => e.toLogId === logId);
        if (edge && arc.logIds.includes(edge.fromLogId)) {
          callsBackTo.set(logId, edge.fromLogId);
        }
      }

      // Find the root (the log that no one in the chain calls back to)
      const calledBackToSet = new Set(callsBackTo.values());
      const root =
        arc.logIds.find((id) => !callsBackTo.has(id)) ||
        arc.logIds.find((id) => !calledBackToSet.has(id) || id === arc.id);

      // Traverse the chain: start from logs that call back to root, then their callers, etc.
      const sortedLogIds = [];
      const remaining = new Set(arc.logIds);

      // Start with the root
      if (root && remaining.has(root)) {
        sortedLogIds.push(root);
        remaining.delete(root);
      }

      // Keep adding logs that call back to the last added log
      while (remaining.size > 0) {
        const lastAdded = sortedLogIds[sortedLogIds.length - 1];
        let foundNext = false;
        for (const id of remaining) {
          if (callsBackTo.get(id) === lastAdded) {
            sortedLogIds.push(id);
            remaining.delete(id);
            foundNext = true;
            break;
          }
        }
        // If no chain found, just add remaining by date as fallback
        if (!foundNext) {
          const remainingArr = [...remaining].sort((a, b) => {
            return compareKeys(getSortKey(a), getSortKey(b));
          });
          sortedLogIds.push(...remainingArr);
          break;
        }
      }

      // Create slots for this arc column
      // Get the actual column x position (which may be saved)
      const colX = this._arcColumns[this._arcColumns.length - 1].x;
      for (let slotIdx = 0; slotIdx < slotCount; slotIdx++) {
        const slotY = startY + slotIdx * verticalSpacing;
        const nodeId = sortedLogIds[slotIdx] || null;

        this._slots.push({
          x: colX,
          y: slotY,
          arcId: arc.id,
          slotIndex: slotIdx,
          nodeId: nodeId,
          color: this._getColorForIndex(arc.colorIndex),
        });

        // Position the node if it exists
        if (nodeId) {
          const node = this._nodes.find((n) => n.id === nodeId);
          if (node) {
            // Use saved position if available, otherwise use slot position
            if (ignoreSavedPositions || !node.hasSavedPosition) {
              node.x = colX;
              node.y = slotY;
            }
            node.radius = nodeRadius;
            node.slotArcId = arc.id;
            node.slotIndex = slotIdx;
            assignedNodeIds.add(nodeId);
          }
        }
      }

      colIndex++;
    }

    // Position unassigned nodes in a staging area to the right
    const stagingStartX = startX + colIndex * horizontalSpacing + 60;
    this._stagingX = stagingStartX; // Store for header rendering
    const stagingColWidth = 100;
    const maxNodesPerCol = 6;

    const unassignedNodes = this._nodes.filter(
      (n) => !assignedNodeIds.has(n.id),
    );

    // Sort unassigned nodes by callback chain order, then by date
    // Build callback chain map for unassigned nodes
    const unassignedIds = new Set(unassignedNodes.map((n) => n.id));
    const callsBackToUnassigned = new Map();
    for (const node of unassignedNodes) {
      const edge = this._edges.find((e) => e.toLogId === node.id);
      if (edge && unassignedIds.has(edge.fromLogId)) {
        callsBackToUnassigned.set(node.id, edge.fromLogId);
      }
    }

    // Group unassigned nodes into chains
    const sortedUnassigned = [];
    const processed = new Set();

    // Find roots (nodes that don't call back to any other unassigned node - i.e., oldest in chain)
    const roots = unassignedNodes
      .filter((n) => !callsBackToUnassigned.has(n.id))
      .sort((a, b) => compareKeys(getSortKey(a.id), getSortKey(b.id)));

    // Process each root and its chain
    for (const root of roots) {
      if (processed.has(root.id)) continue;

      // Add root
      sortedUnassigned.push(root);
      processed.add(root.id);

      // Follow chain
      let current = root.id;
      while (true) {
        const caller = unassignedNodes.find(
          (n) =>
            !processed.has(n.id) && callsBackToUnassigned.get(n.id) === current,
        );
        if (!caller) break;
        sortedUnassigned.push(caller);
        processed.add(caller.id);
        current = caller.id;
      }
    }

    // Add any remaining unprocessed nodes (shouldn't happen, but fallback)
    for (const node of unassignedNodes) {
      if (!processed.has(node.id)) {
        sortedUnassigned.push(node);
      }
    }

    let stagingCol = 0;
    let stagingRow = 0;
    for (const node of sortedUnassigned) {
      // Use saved position if available, otherwise use staging position
      if (ignoreSavedPositions || !node.hasSavedPosition) {
        node.x = stagingStartX + stagingCol * stagingColWidth;
        node.y = startY + stagingRow * verticalSpacing;
      }
      node.radius = nodeRadius;
      node.slotArcId = null;
      node.slotIndex = null;

      stagingRow++;
      if (stagingRow >= maxNodesPerCol) {
        stagingRow = 0;
        stagingCol++;
      }
    }
  }

  /**
   * Main render method - creates all PixiJS display objects.
   */
  _renderFlowchart() {
    if (!this._pixiApp || !this._viewport) return;

    // Clear all layers
    this._layers.slots?.removeChildren();
    this._layers.arcs?.removeChildren();
    this._layers.edges?.removeChildren();
    this._layers.nodes?.removeChildren();
    this._layers.labels?.removeChildren();
    this._layers.headers?.removeChildren();
    this._nodeSprites.clear();

    // Render each layer
    this._renderColumnHeaders();
    this._renderSlots();
    this._renderArcBoxes();
    this._renderEdges();
    this._renderNodes();
    // Labels are now shown on hover only via _showNodeLabel()
  }

  /**
   * Render column header labels for arc columns.
   */
  _renderColumnHeaders() {
    if (!this._layers.headers) return;

    const nodeRadius = 24;
    const padding = 16;
    const headerGap = 8; // Gap between header text and box top

    // Render arc column headers
    for (const col of this._arcColumns) {
      // Find the arc and its nodes to compute the box top edge
      const arc = this._arcs.find((a) => a.id === col.arcId);
      const arcNodes = arc
        ? this._nodes.filter((n) => arc.logIds.includes(n.id))
        : [];

      // Derive header position from actual node positions (centered above the arc box)
      let headerX = col.x; // fallback
      let headerY = col.y; // fallback
      if (arcNodes.length >= 2) {
        let minX = Infinity,
          minY = Infinity;
        let maxX = -Infinity;
        for (const node of arcNodes) {
          minX = Math.min(minX, node.x - nodeRadius);
          minY = Math.min(minY, node.y - nodeRadius);
          maxX = Math.max(maxX, node.x + nodeRadius);
        }
        headerX = (minX + maxX) / 2;
        headerY = minY - padding - headerGap;
      } else if (arcNodes.length === 1) {
        headerX = arcNodes[0].x;
        headerY = arcNodes[0].y - nodeRadius - padding - headerGap;
      }

      const text = new PIXI.Text(col.valueName, {
        fontFamily: "Signika",
        fontSize: 14,
        fontWeight: "bold",
        fill: col.color,
        align: "center",
        wordWrap: true,
        wordWrapWidth: 140,
      });
      text.anchor.set(0.5, 1); // Center horizontally, anchor at bottom
      text.x = headerX;
      text.y = headerY;

      this._layers.headers.addChild(text);
    }
  }

  /**
   * Draw empty slot indicators for arc columns.
   */
  _renderSlots() {
    if (!this._slots.length || !this._layers.slots) return;

    const nodeRadius = 24;

    for (const slot of this._slots) {
      // Only draw slot if it's empty (no node assigned)
      if (slot.nodeId) continue;

      const graphics = new PIXI.Graphics();

      // Draw a filled background circle with low opacity
      graphics.beginFill(slot.color, 0.15);
      graphics.drawCircle(slot.x, slot.y, nodeRadius);
      graphics.endFill();

      // Draw solid circle outline for empty slot
      graphics.lineStyle(3, slot.color, 0.6);
      graphics.drawCircle(slot.x, slot.y, nodeRadius);

      // Draw a "+" in the center
      const plusSize = 10;
      graphics.lineStyle(2, slot.color, 0.7);
      graphics.moveTo(slot.x - plusSize, slot.y);
      graphics.lineTo(slot.x + plusSize, slot.y);
      graphics.moveTo(slot.x, slot.y - plusSize);
      graphics.lineTo(slot.x, slot.y + plusSize);

      this._layers.slots.addChild(graphics);
    }
  }

  /**
   * Setup pan and zoom interactions on the viewport.
   */
  _setupViewportInteractions() {
    if (!this._pixiApp) return;

    const stage = this._pixiApp.stage;
    let dragging = false;
    let lastPos = { x: 0, y: 0 };
    let clickedOnEmpty = false; // Track if we clicked on empty canvas space

    // Pan with middle mouse, right-click, or shift+drag
    stage.on("pointerdown", (e) => {
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
        dragging = true;
        lastPos = { x: e.global.x, y: e.global.y };
        e.stopPropagation();
      } else if (e.button === 0) {
        // Left click on empty space (not captured by node/arc) - start selection box
        clickedOnEmpty = true;
        lastPos = { x: e.global.x, y: e.global.y };
        // Convert to viewport coordinates for selection box
        const worldPos = this._screenToWorld(e.global.x, e.global.y);
        this._selectionBoxState = {
          startX: worldPos.x,
          startY: worldPos.y,
          currentX: worldPos.x,
          currentY: worldPos.y,
          active: false, // Becomes active once moved threshold
        };
      }
    });

    stage.on("pointermove", (e) => {
      // Handle canvas pan
      if (dragging && this._viewport) {
        const dx = e.global.x - lastPos.x;
        const dy = e.global.y - lastPos.y;
        this._viewport.x += dx;
        this._viewport.y += dy;
        lastPos = { x: e.global.x, y: e.global.y };
      }

      // Handle selection box drag
      if (this._selectionBoxState && clickedOnEmpty && !dragging) {
        const worldPos = this._screenToWorld(e.global.x, e.global.y);
        const dx = worldPos.x - this._selectionBoxState.startX;
        const dy = worldPos.y - this._selectionBoxState.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Activate selection box once moved threshold
        if (dist > 10) {
          this._selectionBoxState.active = true;
        }
        if (this._selectionBoxState.active) {
          this._selectionBoxState.currentX = worldPos.x;
          this._selectionBoxState.currentY = worldPos.y;
          this._drawSelectionBox();
        }
      }

      // Handle node link drag preview
      if (this._linkDragState && this._linkDragState.active) {
        this._updateLinkDragLine(e.global.x, e.global.y);
      }

      // Handle arc box drag at stage level (for fast drags)
      if (this._arcDragState) {
        const arc = this._arcs.find((a) => a.id === this._arcDragState.arcId);
        if (arc) {
          this._onArcBoxPointerMove(e, arc);
        }
      }

      // Handle node drag at stage level (for fast drags)
      if (this._dragState && this._dragState.nodeId) {
        const node = this._nodes.find((n) => n.id === this._dragState.nodeId);
        if (node) {
          this._onNodePointerMove(e, node);
        }
      }
    });

    stage.on("pointerup", (e) => {
      // Check if we completed a selection box drag
      if (this._selectionBoxState && this._selectionBoxState.active) {
        this._completeSelectionBox();
        this._selectionBoxState = null;
        clickedOnEmpty = false;
        dragging = false;
        return;
      }

      // Check if this was a click on empty space (not a drag)
      if (clickedOnEmpty && !dragging) {
        const dx = e.global.x - lastPos.x;
        const dy = e.global.y - lastPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // If we didn't move much, treat it as a click to deselect
        if (
          dist < 5 &&
          (this._selectedNodeId || this._selectedNodeIds.size > 0)
        ) {
          this._selectedNodeId = null;
          this._selectedNodeIds.clear();
          this._renderFlowchart();
          this._updateSidebar(null);
          this._updateDescriptionSidebar(null);
        }
      }
      clickedOnEmpty = false;
      dragging = false;
      this._selectionBoxState = null;
      // Cancel link drag if released on empty space
      this._cancelLinkDrag();
      // Complete arc drag
      this._completeArcDrag();
      // Complete node drag
      this._completeNodeDrag();
    });

    stage.on("rightup", () => {
      clickedOnEmpty = false;
      dragging = false; // End pan if right-click was used
      // Cancel selection box
      this._selectionBoxState = null;
      this._layers.selection?.removeChildren();
      // Cancel link drag if released on empty space
      this._cancelLinkDrag();
      // Clear any node drag state
      this._dragState = null;
    });

    stage.on("pointerupoutside", () => {
      clickedOnEmpty = false;
      dragging = false;
      // Cancel selection box
      this._selectionBoxState = null;
      this._layers.selection?.removeChildren();
      // Complete arc drag if released outside
      this._completeArcDrag();
      // Complete node drag if released outside
      this._completeNodeDrag();
    });

    // Zoom with scroll wheel
    this._pixiApp.view.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (!this._viewport) return;

        const scaleBy = 1.1;
        const oldScale = this._viewport.scale.x;
        const newScale = e.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
        const clampedScale = Math.max(0.25, Math.min(3, newScale));

        // Zoom toward mouse position
        const rect = this._pixiApp.view.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const worldPos = {
          x: (mouseX - this._viewport.x) / oldScale,
          y: (mouseY - this._viewport.y) / oldScale,
        };

        this._viewport.scale.set(clampedScale);
        this._viewport.x = mouseX - worldPos.x * clampedScale;
        this._viewport.y = mouseY - worldPos.y * clampedScale;
      },
      { passive: false },
    );
  }

  /**
   * Convert screen coordinates to world (viewport) coordinates.
   */
  _screenToWorld(screenX, screenY) {
    const scale = this._viewport.scale.x;
    return {
      x: (screenX - this._viewport.x) / scale,
      y: (screenY - this._viewport.y) / scale,
    };
  }

  /**
   * Draw the selection box on the canvas.
   */
  _drawSelectionBox() {
    if (!this._selectionBoxState || !this._layers.selection) return;

    this._layers.selection.removeChildren();

    const { startX, startY, currentX, currentY } = this._selectionBoxState;
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);

    const box = new PIXI.Graphics();
    box.beginFill(0x2196f3, 0.1);
    box.lineStyle(2, 0x2196f3, 0.8);
    box.drawRect(x, y, w, h);
    box.endFill();

    this._layers.selection.addChild(box);
  }

  /**
   * Complete selection box drag and select nodes within.
   */
  _completeSelectionBox() {
    if (!this._selectionBoxState || !this._selectionBoxState.active) return;

    const { startX, startY, currentX, currentY } = this._selectionBoxState;
    const minX = Math.min(startX, currentX);
    const maxX = Math.max(startX, currentX);
    const minY = Math.min(startY, currentY);
    const maxY = Math.max(startY, currentY);

    // Find all nodes within the selection box
    this._selectedNodeIds.clear();
    this._selectedNodeId = null;

    for (const node of this._nodes) {
      if (
        node.x >= minX &&
        node.x <= maxX &&
        node.y >= minY &&
        node.y <= maxY
      ) {
        this._selectedNodeIds.add(node.id);
      }
    }

    // Clear the selection box graphic
    this._layers.selection.removeChildren();

    // Re-render to show selected state
    this._renderFlowchart();

    // Update sidebar (show count or first node)
    if (this._selectedNodeIds.size === 1) {
      const nodeId = [...this._selectedNodeIds][0];
      this._updateSidebar(nodeId);
      this._updateDescriptionSidebar(nodeId);
    } else if (this._selectedNodeIds.size > 1) {
      this._updateSidebarMultiSelect(this._selectedNodeIds.size);
      this._updateDescriptionSidebar(null);
    } else {
      this._updateSidebar(null);
      this._updateDescriptionSidebar(null);
    }
  }

  /**
   * Update sidebar for multi-selection.
   */
  _updateSidebarMultiSelect(count) {
    if (!this._sidebarEl) return;
    this._sidebarEl.innerHTML = `<div class="sta-flowchart-sidebar-multi">${count} nodes selected</div>`;
  }

  /**
   * Color palette for values (8 distinct colors).
   */
  static COLOR_PALETTE = [
    0xca99cc, // V1
    0xffcc9c, // V2
    0xcd6666, // V3
    0x999ace, // V4
    0xff9a65, // V5
    0xcc6699, // V6
    0x4e81b6, // V7
    0x6da38c, // V8
  ];

  /**
   * Get a color for a value by its index.
   */
  _getColorForIndex(index) {
    return MissionFlowchartApp.COLOR_PALETTE[
      index % MissionFlowchartApp.COLOR_PALETTE.length
    ];
  }

  /**
   * Get color for a value ID.
   */
  _getColorForValueId(valueId) {
    const index = this._valueColors.get(valueId) ?? 0;
    return this._getColorForIndex(index);
  }

  /**
   * Convert hex number to CSS color string.
   */
  _hexToString(hex) {
    return `#${hex.toString(16).padStart(6, "0")}`;
  }

  /**
   * Draw colored rectangles around completed arc chains.
   */
  _renderArcBoxes() {
    if (!this._arcs.length || !this._layers.arcs) return;

    this._arcBoxSprites.clear();

    for (const arc of this._arcs) {
      const arcNodes = this._nodes.filter((n) => arc.logIds.includes(n.id));
      if (arcNodes.length < 2) continue;

      const padding = 16;
      const nodeRadius = arcNodes[0]?.radius ?? 24;

      let minX = Infinity,
        minY = Infinity;
      let maxX = -Infinity,
        maxY = -Infinity;

      for (const node of arcNodes) {
        minX = Math.min(minX, node.x - nodeRadius);
        minY = Math.min(minY, node.y - nodeRadius);
        maxX = Math.max(maxX, node.x + nodeRadius);
        maxY = Math.max(maxY, node.y + nodeRadius);
      }

      const color = this._getColorForIndex(arc.colorIndex);
      const x = minX - padding;
      const y = minY - padding;
      const w = maxX - minX + padding * 2;
      const h = maxY - minY + padding * 2;

      const graphics = new PIXI.Graphics();

      // Fill with low opacity (PIXI v7 API)
      graphics.beginFill(color, 0.1);
      graphics.drawRoundedRect(x, y, w, h, 12);
      graphics.endFill();
      graphics.lineStyle(3, color);
      graphics.drawRoundedRect(x, y, w, h, 12);

      // Make arc box interactive for dragging
      graphics.interactive = true;
      graphics.cursor = "grab";
      graphics.hitArea = new PIXI.Rectangle(x, y, w, h);

      // Store arc data on the graphics object
      graphics.arcData = {
        arcId: arc.id,
        logIds: arc.logIds,
        bounds: { x, y, w, h },
      };

      graphics.on("pointerdown", (e) => this._onArcBoxPointerDown(e, arc));
      graphics.on("pointermove", (e) => this._onArcBoxPointerMove(e, arc));
      graphics.on("pointerup", (e) => this._onArcBoxPointerUp(e, arc));

      this._arcBoxSprites.set(arc.id, graphics);
      this._layers.arcs.addChild(graphics);
    }
  }

  /**
   * Handle arc box pointer down (start potential drag).
   */
  _onArcBoxPointerDown(event, arc) {
    event.stopPropagation();

    // Only left-click for arc dragging
    if (event.button !== 0) return;

    const arcNodes = this._nodes.filter((n) => arc.logIds.includes(n.id));
    const nodeStartPositions = new Map();
    for (const node of arcNodes) {
      nodeStartPositions.set(node.id, { x: node.x, y: node.y });
    }

    // Find the arc column for this arc
    const arcColumn = this._arcColumns.find((col) => col.arcId === arc.id);
    const columnStartX = arcColumn?.x ?? 0;
    const columnStartY = arcColumn?.y ?? 0;

    this._arcDragState = {
      arcId: arc.id,
      startX: event.global.x,
      startY: event.global.y,
      dragging: false,
      nodeStartPositions,
      logIds: arc.logIds,
      columnStartX,
      columnStartY,
    };
  }

  /**
   * Handle arc box pointer move (drag arc and all its nodes).
   */
  _onArcBoxPointerMove(event, arc) {
    if (!this._arcDragState || this._arcDragState.arcId !== arc.id) return;

    const dx = event.global.x - this._arcDragState.startX;
    const dy = event.global.y - this._arcDragState.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Start dragging after moving 5 pixels
    if (!this._arcDragState.dragging && dist > 5) {
      this._arcDragState.dragging = true;
      // Change cursor to grabbing
      const graphics = this._arcBoxSprites.get(arc.id);
      if (graphics) graphics.cursor = "grabbing";
    }

    if (this._arcDragState.dragging) {
      const scale = this._viewport?.scale?.x ?? 1;
      const moveDx = dx / scale;
      const moveDy = dy / scale;

      // Move all nodes in the arc
      for (const nodeId of this._arcDragState.logIds) {
        const startPos = this._arcDragState.nodeStartPositions.get(nodeId);
        const nodeObj = this._nodes.find((n) => n.id === nodeId);
        if (!startPos || !nodeObj) continue;

        nodeObj.x = startPos.x + moveDx;
        nodeObj.y = startPos.y + moveDy;

        // Update sprite position
        const container = this._nodeSprites.get(nodeId);
        if (container) {
          container.x = nodeObj.x;
          container.y = nodeObj.y;
        }
      }

      // Update the arc column position for the header
      const arcColumn = this._arcColumns.find(
        (col) => col.arcId === this._arcDragState.arcId,
      );
      if (arcColumn) {
        arcColumn.x = this._arcDragState.columnStartX + moveDx;
        arcColumn.y = this._arcDragState.columnStartY + moveDy;
      }

      // Re-render edges, arc boxes, and headers
      this._layers.edges?.removeChildren();
      this._layers.arcs?.removeChildren();
      this._layers.headers?.removeChildren();
      this._renderEdges();
      this._renderArcBoxes();
      this._renderColumnHeaders();
    }
  }

  /**
   * Handle arc box pointer up (complete drag).
   */
  _onArcBoxPointerUp(event, arc) {
    event.stopPropagation();

    if (this._arcDragState && this._arcDragState.arcId === arc.id) {
      // Reset cursor
      const graphics = this._arcBoxSprites.get(arc.id);
      if (graphics) graphics.cursor = "grab";

      // Re-render to finalize positions
      if (this._arcDragState.dragging) {
        this._markDirty();
        this._layers.slots?.removeChildren();
        this._layers.edges?.removeChildren();
        this._layers.arcs?.removeChildren();
        this._layers.headers?.removeChildren();
        this._renderColumnHeaders();
        this._renderSlots();
        this._renderEdges();
        this._renderArcBoxes();
      }
    }

    this._arcDragState = null;
  }

  /**
   * Complete arc drag when released on stage (not on arc box).
   */
  _completeArcDrag() {
    if (!this._arcDragState) return;

    // Reset cursor if we have the graphics
    const graphics = this._arcBoxSprites.get(this._arcDragState.arcId);
    if (graphics) graphics.cursor = "grab";

    // Re-render to finalize positions
    if (this._arcDragState.dragging) {
      this._markDirty();
      this._layers.slots?.removeChildren();
      this._layers.edges?.removeChildren();
      this._layers.arcs?.removeChildren();
      this._layers.headers?.removeChildren();
      this._renderColumnHeaders();
      this._renderSlots();
      this._renderEdges();
      this._renderArcBoxes();
    }

    this._arcDragState = null;
  }

  /**
   * Complete node drag when released on stage (not on node).
   */
  _completeNodeDrag() {
    if (!this._dragState) return;

    const nodeId = this._dragState.nodeId;
    const node = this._nodes.find((n) => n.id === nodeId);

    // Mark as dirty since positions changed
    if (this._dragState.dragging && this._dragState.mode === "move" && node) {
      this._markDirty();

      // Re-render to update visuals
      this._layers.slots?.removeChildren();
      this._layers.edges?.removeChildren();
      this._layers.arcs?.removeChildren();
      this._renderSlots();
      this._renderEdges();
      this._renderArcBoxes();
    }

    this._dragState = null;
  }

  /**
   * Draw arrows from the log making a callback TO the callback target.
   * Arrow points from the newer log to the older log it references.
   */
  _renderEdges() {
    if (!this._edges.length || !this._layers.edges) return;

    const nodeMap = new Map(this._nodes.map((n) => [n.id, n]));

    for (const edge of this._edges) {
      // fromLogId = callback target (older log being referenced)
      // toLogId = the log making the callback (newer log)
      const targetNode = nodeMap.get(edge.fromLogId); // older, at top
      const callerNode = nodeMap.get(edge.toLogId); // newer, below
      if (!targetNode || !callerNode) continue;

      const color = this._getColorForValueId(edge.valueId);
      const callerRadius = callerNode.radius ?? 24;
      const targetRadius = targetNode.radius ?? 24;

      // Calculate angle from caller to target (center to center)
      const dx = targetNode.x - callerNode.x;
      const dy = targetNode.y - callerNode.y;
      const angle = Math.atan2(dy, dx);

      // Start point: edge of caller node closest to target
      const startX = callerNode.x + callerRadius * Math.cos(angle);
      const startY = callerNode.y + callerRadius * Math.sin(angle);

      // End point: edge of target node closest to caller (opposite direction)
      const endX = targetNode.x - targetRadius * Math.cos(angle);
      const endY = targetNode.y - targetRadius * Math.sin(angle);

      const graphics = new PIXI.Graphics();

      // Draw line (PIXI v7 API)
      graphics.lineStyle(2, color);
      graphics.moveTo(startX, startY);

      // Use bezier curve only for longer distances; short ones stay straight
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDistForCurve = 120; // Only curve if nodes are far apart
      if (dist > minDistForCurve) {
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        // Add a slight curve perpendicular to the line, scaling with distance
        const perpAngle = angle + Math.PI / 2;
        // Curve offset grows slowly with distance, capped at 25
        const curveOffset = Math.min(25, (dist - minDistForCurve) * 0.1);
        const ctrlX = midX + curveOffset * Math.cos(perpAngle);
        const ctrlY = midY + curveOffset * Math.sin(perpAngle);
        graphics.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
      } else {
        graphics.lineTo(endX, endY);
      }

      // Draw arrowhead pointing toward target
      const arrowSize = 8;
      graphics.beginFill(color);
      graphics.moveTo(endX, endY);
      graphics.lineTo(
        endX - arrowSize * Math.cos(angle - Math.PI / 6),
        endY - arrowSize * Math.sin(angle - Math.PI / 6),
      );
      graphics.lineTo(
        endX - arrowSize * Math.cos(angle + Math.PI / 6),
        endY - arrowSize * Math.sin(angle + Math.PI / 6),
      );
      graphics.lineTo(endX, endY);
      graphics.endFill();

      this._layers.edges.addChild(graphics);

      // Make edge interactive for milestone hover if it has an associated milestone
      if (edge.milestoneName) {
        // Add an invisible wider hit area for easier hovering
        const hitGraphics = new PIXI.Graphics();
        hitGraphics.lineStyle(12, 0x000000, 0.001); // Nearly invisible, wide line
        hitGraphics.moveTo(startX, startY);
        if (dist > minDistForCurve) {
          const perpAngle = angle + Math.PI / 2;
          const curveOffset = Math.min(25, (dist - minDistForCurve) * 0.1);
          const midX = (startX + endX) / 2;
          const midY = (startY + endY) / 2;
          const ctrlX = midX + curveOffset * Math.cos(perpAngle);
          const ctrlY = midY + curveOffset * Math.sin(perpAngle);
          hitGraphics.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
        } else {
          hitGraphics.lineTo(endX, endY);
        }
        hitGraphics.eventMode = "static";
        hitGraphics.cursor = "pointer";

        // Store milestone info for hover display
        // Position at 40% of the way from caller (start) to target (end)
        const milestoneInfo = {
          name: edge.milestoneName,
          isArc: edge.milestoneIsArc,
          color,
          midX: startX + (endX - startX) * 0.4,
          midY: startY + (endY - startY) * 0.4,
          angle, // Line angle for perpendicular offset on short edges
          dist, // Line length to determine if we need offset
        };

        hitGraphics.on("pointerover", () =>
          this._showMilestoneLabel(milestoneInfo),
        );
        hitGraphics.on("pointerout", () => this._hideMilestoneLabel());

        this._layers.edges.addChild(hitGraphics);
      }
    }
  }

  /**
   * Draw a dotted/dashed rectangle border.
   */
  _drawDottedRect(graphics, x, y, w, h, radius, color, dashLen, gapLen) {
    graphics.lineStyle(1, color);

    // Draw dotted lines for each side (simplified - just do top/bottom/left/right)
    const drawDottedLine = (x1, y1, x2, y2) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ux = dx / len;
      const uy = dy / len;
      let pos = 0;
      let drawing = true;
      while (pos < len) {
        const segLen = drawing ? dashLen : gapLen;
        const endPos = Math.min(pos + segLen, len);
        if (drawing) {
          graphics.moveTo(x1 + ux * pos, y1 + uy * pos);
          graphics.lineTo(x1 + ux * endPos, y1 + uy * endPos);
        }
        pos = endPos;
        drawing = !drawing;
      }
    };

    // Top edge (with radius offset)
    drawDottedLine(x + radius, y, x + w - radius, y);
    // Bottom edge
    drawDottedLine(x + radius, y + h, x + w - radius, y + h);
    // Left edge
    drawDottedLine(x, y + radius, x, y + h - radius);
    // Right edge
    drawDottedLine(x + w, y + radius, x + w, y + h - radius);
  }

  /**
   * Draw nodes as interactive circles with pie-chart fills.
   */
  _renderNodes() {
    if (!this._nodes.length || !this._layers.nodes) return;

    for (const node of this._nodes) {
      const x = node.x;
      const y = node.y;
      const radius = node.radius ?? 24;
      const valueIds = node.valueIds ?? [];
      const primaryValueId = node.primaryValueId;
      const isSelected =
        this._selectedNodeId === node.id || this._selectedNodeIds.has(node.id);
      const isUsed = node.isUsed;

      // Create a container for this node
      const container = new PIXI.Container();
      container.x = x;
      container.y = y;
      container.eventMode = "static";
      container.cursor = "pointer";
      container.hitArea = new PIXI.Circle(0, 0, radius + 5);

      // Store reference
      this._nodeSprites.set(node.id, container);

      const graphics = new PIXI.Graphics();

      // Draw pie segments (PIXI v7 API)
      // Use reduced alpha for used nodes to show desaturation
      const fillAlpha = isUsed ? 0.5 : 1.0;
      if (valueIds.length > 0) {
        const segmentAngle = (2 * Math.PI) / valueIds.length;
        let startAngle = -Math.PI / 2;

        for (const vid of valueIds) {
          const color = this._getColorForValueId(vid);
          graphics.beginFill(color, fillAlpha);
          graphics.moveTo(0, 0);
          graphics.arc(0, 0, radius, startAngle, startAngle + segmentAngle);
          graphics.lineTo(0, 0);
          graphics.endFill();
          startAngle += segmentAngle;
        }
      } else {
        graphics.beginFill(0x666666, fillAlpha);
        graphics.drawCircle(0, 0, radius);
        graphics.endFill();
      }

      // Draw outline
      const outlineColor = isSelected
        ? 0xffffff
        : primaryValueId
          ? this._getColorForValueId(primaryValueId)
          : 0x333333;
      graphics.lineStyle(isSelected ? 4 : 2, outlineColor);
      graphics.drawCircle(0, 0, radius);

      // Inner black ring
      graphics.lineStyle(1, 0x000000);
      graphics.drawCircle(0, 0, radius);

      // Arc-end indicator (double ring)
      if (node.isArcEnd) {
        const arcColor = primaryValueId
          ? this._getColorForValueId(primaryValueId)
          : 0xffffff;
        graphics.lineStyle(2, arcColor);
        graphics.drawCircle(0, 0, radius + 4);
        graphics.lineStyle(1, arcColor, 0.5);
        graphics.drawCircle(0, 0, radius + 8);
      }

      container.addChild(graphics);

      // Add event handlers
      container.on("pointerdown", (e) => this._onNodePointerDown(e, node));
      container.on("rightdown", (e) => this._onNodePointerDown(e, node));
      container.on("pointermove", (e) => this._onNodePointerMove(e, node));
      container.on("pointerup", (e) => this._onNodePointerUp(e, node));
      container.on("rightup", (e) => this._onNodePointerUp(e, node));
      container.on("pointerover", () => this._onNodeHover(node, true));
      container.on("pointerout", () => this._onNodeHover(node, false));

      this._layers.nodes.addChild(container);
    }
  }

  /**
   * Get all node IDs that should move together with a given node.
   * If the node is part of a multi-selection, move all selected nodes.
   * Otherwise, move only the dragged node.
   */
  _getGroupedNodeIds(nodeId) {
    // If this node is part of multi-selection, move all selected nodes
    if (this._selectedNodeIds.size > 0 && this._selectedNodeIds.has(nodeId)) {
      return [...this._selectedNodeIds];
    }
    return [nodeId];
  }

  /**
   * Handle node pointer down (start potential drag or link).
   */
  _onNodePointerDown(event, node) {
    event.stopPropagation();

    // Right-click (button 2) = create link, left-click = move node
    const isLinkMode = event.button === 2;

    // Prevent context menu on right-click
    if (isLinkMode) {
      event.preventDefault?.();
    }

    this._dragState = {
      nodeId: node.id,
      startX: event.global.x,
      startY: event.global.y,
      nodeStartX: node.x,
      nodeStartY: node.y,
      dragging: false,
      mode: isLinkMode ? "link" : "move",
      groupNodeIds: isLinkMode ? [] : this._getGroupedNodeIds(node.id),
      groupStartPositions: new Map(),
    };

    // Store initial positions for all nodes in the group
    if (!isLinkMode) {
      for (const id of this._dragState.groupNodeIds) {
        const n = this._nodes.find((nd) => nd.id === id);
        if (n) {
          this._dragState.groupStartPositions.set(id, { x: n.x, y: n.y });
        }
      }
    }
  }

  /**
   * Handle pointer move on a node (drag node or start link).
   */
  _onNodePointerMove(event, node) {
    if (!this._dragState || this._dragState.nodeId !== node.id) return;

    const dx = event.global.x - this._dragState.startX;
    const dy = event.global.y - this._dragState.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Start dragging after moving 10 pixels
    if (!this._dragState.dragging && dist > 10) {
      this._dragState.dragging = true;
      if (this._dragState.mode === "link") {
        this._startLinkDrag(node, event.global.x, event.global.y);
      }
    }

    // Move node(s) if in move mode and dragging
    if (this._dragState.dragging && this._dragState.mode === "move") {
      const scale = this._viewport?.scale?.x ?? 1;
      const moveDx = dx / scale;
      const moveDy = dy / scale;

      // Move all nodes in the group
      for (const id of this._dragState.groupNodeIds) {
        const startPos = this._dragState.groupStartPositions.get(id);
        const nodeObj = this._nodes.find((n) => n.id === id);
        if (!startPos || !nodeObj) continue;

        nodeObj.x = startPos.x + moveDx;
        nodeObj.y = startPos.y + moveDy;

        // Update sprite position
        const container = this._nodeSprites.get(id);
        if (container) {
          container.x = nodeObj.x;
          container.y = nodeObj.y;
        }
      }

      // Re-render edges, arc boxes, and slots (to show highlight)
      this._layers.slots?.removeChildren();
      this._layers.edges?.removeChildren();
      this._layers.arcs?.removeChildren();
      this._renderSlots();
      this._renderEdges();
      this._renderArcBoxes();
    }
  }

  /**
   * Handle node pointer up (select, or complete drag-to-link/move).
   */
  _onNodePointerUp(event, node) {
    event.stopPropagation();

    // Check if we're completing a link drag to this node
    if (this._linkDragState && this._linkDragState.active) {
      const sourceId = this._linkDragState.sourceNodeId;
      if (sourceId !== node.id) {
        // Create callback link from source to this node
        this._createCallbackLink(sourceId, node.id);
      }
      this._cancelLinkDrag();
      this._dragState = null;
      return;
    }

    if (this._dragState && !this._dragState.dragging) {
      // This was a click, not a drag - select the node
      this._selectNode(node.id, event.ctrlKey || event.metaKey);
    } else if (this._dragState && this._dragState.dragging) {
      // A drag was completed - mark as dirty
      this._markDirty();
    }
    this._dragState = null;
  }

  /**
   * Handle node hover state.
   */
  _onNodeHover(node, isOver) {
    const container = this._nodeSprites.get(node.id);
    if (!container) return;
    container.alpha = isOver ? 0.85 : 1;

    // Show/hide label on hover
    if (isOver) {
      this._showNodeLabel(node);
      // Show chain preview slots if this node is in an incomplete chain
      this._showChainPreviewSlots(node);
      // Show milestone label if this node makes a callback with a milestone
      this._showMilestoneForNode(node);
    } else {
      this._hideNodeLabel();
      this._hideChainPreviewSlots();
      this._hideMilestoneLabel();
    }

    // Show drop target indicator during link drag
    if (this._linkDragState && this._linkDragState.active) {
      if (isOver && this._linkDragState.sourceNodeId !== node.id) {
        container.scale.set(1.15);
      } else {
        container.scale.set(1);
      }
    }
  }

  /**
   * Get all nodes in the same callback chain as a given node.
   * Returns array of node IDs sorted from root (oldest) to tip (newest).
   * Stops at completed arc boundaries - does not include nodes from completed arcs.
   */
  _getCallbackChain(nodeId) {
    const visited = new Set();
    const chainIds = [];

    // Build lookup maps
    const callsBackTo = new Map(); // nodeId -> targetId it calls back to
    const calledBackBy = new Map(); // nodeId -> array of nodeIds that call back to it

    for (const edge of this._edges) {
      callsBackTo.set(edge.toLogId, edge.fromLogId);
      if (!calledBackBy.has(edge.fromLogId)) {
        calledBackBy.set(edge.fromLogId, []);
      }
      calledBackBy.get(edge.fromLogId).push(edge.toLogId);
    }

    // Helper to check if a node is part of a completed arc
    const isInCompletedArc = (nid) => {
      const n = this._nodes.find((nd) => nd.id === nid);
      return n?.arcId || n?.isArcEnd;
    };

    // Find the root by following callsBackTo from our node
    // Stop when we hit a node that's part of a completed arc
    let current = nodeId;
    while (callsBackTo.has(current) && !visited.has(current)) {
      const target = callsBackTo.get(current);
      // Stop if we'd enter a completed arc
      if (isInCompletedArc(target)) break;
      visited.add(current);
      current = target;
    }
    const rootId = current;

    // If the root itself is in a completed arc, this node links to an arc but isn't part of it
    // In that case, start the chain from our original node
    const startId = isInCompletedArc(rootId) ? nodeId : rootId;

    // Now traverse from root forward using calledBackBy
    // Only include nodes that aren't in completed arcs
    visited.clear();
    const queue = [startId];
    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      if (isInCompletedArc(id)) continue; // Skip completed arc nodes
      visited.add(id);
      chainIds.push(id);

      const callers = calledBackBy.get(id) || [];
      for (const callerId of callers) {
        if (!visited.has(callerId) && !isInCompletedArc(callerId)) {
          queue.push(callerId);
        }
      }
    }

    return chainIds;
  }

  /**
   * Show preview slots for an incomplete chain on hover.
   * Shows empty slots below the last node in the chain.
   */
  _showChainPreviewSlots(node) {
    // Don't show if this node is already part of a completed arc
    if (node.arcId || node.isArcEnd) return;

    // Get the chain this node belongs to
    const chainIds = this._getCallbackChain(node.id);

    // Check if this node links to a completed arc (new chain starting from arc)
    const linksToArc = this._edges.some((e) => {
      if (e.toLogId !== node.id) return false;
      const targetNode = this._nodes.find((n) => n.id === e.fromLogId);
      return targetNode?.arcId || targetNode?.isArcEnd;
    });

    // Show preview if: chain has 2+ nodes, OR single node that links to a completed arc
    if (chainIds.length < 2 && !linksToArc) return;

    // Arc requirement is 3 + n where n = number of completed arcs
    const completedArcCount = this._arcs?.length ?? 0;
    const arcStepsNeeded = 3 + completedArcCount;
    const remainingSlots = Math.max(0, arcStepsNeeded - chainIds.length);

    // Don't show if chain is already complete
    if (remainingSlots === 0) return;

    // Clear any existing preview
    this._hideChainPreviewSlots();

    // Create preview container
    if (!this._chainPreviewContainer) {
      this._chainPreviewContainer = new PIXI.Container();
      this._viewport.addChild(this._chainPreviewContainer);
    }

    // Find the last node in the chain (the tip/newest)
    const lastNodeId = chainIds[chainIds.length - 1];
    const lastNode = this._nodes.find((n) => n.id === lastNodeId);
    if (!lastNode) return;

    // Position empty slots directly below the last node
    const nodeRadius = 24;
    const verticalSpacing = 80;
    const slotX = lastNode.x;
    const startY = lastNode.y + verticalSpacing;

    // Determine color from the chain's primary value
    const firstNode = this._nodes.find((n) => n.id === chainIds[0]);
    const color = firstNode?.primaryValueId
      ? this._getColorForValueId(firstNode.primaryValueId)
      : 0x888888;

    // Draw only the remaining empty slots
    for (let i = 0; i < remainingSlots; i++) {
      const slotY = startY + i * verticalSpacing;

      const graphics = new PIXI.Graphics();

      // Draw empty slot indicator
      graphics.beginFill(color, 0.15);
      graphics.drawCircle(slotX, slotY, nodeRadius);
      graphics.endFill();

      graphics.lineStyle(2, color, 0.5);
      graphics.drawCircle(slotX, slotY, nodeRadius);

      // Draw "+" in center
      const plusSize = 10;
      graphics.lineStyle(2, color, 0.6);
      graphics.moveTo(slotX - plusSize, slotY);
      graphics.lineTo(slotX + plusSize, slotY);
      graphics.moveTo(slotX, slotY - plusSize);
      graphics.lineTo(slotX, slotY + plusSize);

      this._chainPreviewContainer.addChild(graphics);
    }

    // Add label showing how many more needed
    const labelText =
      remainingSlots === 1
        ? game.i18n.localize("sta-officers-log.flowchart.oneMoreNeeded") ||
          "1 more"
        : `${remainingSlots} more`;
    const progressText = new PIXI.Text(labelText, {
      fontFamily: "Signika",
      fontSize: 11,
      fill: color,
      align: "center",
    });
    progressText.anchor.set(0.5, 0);
    progressText.x = slotX;
    progressText.y = startY + remainingSlots * verticalSpacing - 10;
    this._chainPreviewContainer.addChild(progressText);
  }

  /**
   * Hide the chain preview slots.
   */
  _hideChainPreviewSlots() {
    if (this._chainPreviewContainer) {
      this._chainPreviewContainer.removeChildren();
    }
  }

  /**
   * Show a label for a node on hover.
   */
  _showNodeLabel(node) {
    // Remove any existing label first
    this._hideNodeLabel();

    const style = {
      fontFamily: "Signika",
      fontSize: 14,
      fill: 0xffffff,
      wordWrap: true,
      wordWrapWidth: 180,
    };
    const label = new PIXI.Text(node.name, style);
    label.anchor.set(0.5, 0);

    // Position label below the node
    label.x = node.x;
    label.y = node.y + 50;

    // Add background
    const padding = 4;
    const bg = new PIXI.Graphics();
    bg.beginFill(0x000000, 0.75);
    bg.drawRoundedRect(
      label.x - label.width / 2 - padding,
      label.y - padding,
      label.width + padding * 2,
      label.height + padding * 2,
      4,
    );
    bg.endFill();

    this._layers.labels.addChild(bg);
    this._layers.labels.addChild(label);
    this._activeLabel = { bg, label };
  }

  /**
   * Hide the current hover label.
   */
  _hideNodeLabel() {
    if (this._activeLabel) {
      this._layers.labels.removeChild(this._activeLabel.bg);
      this._layers.labels.removeChild(this._activeLabel.label);
      this._activeLabel.bg.destroy();
      this._activeLabel.label.destroy();
      this._activeLabel = null;
    }
  }

  /**
   * Show a milestone label on edge hover.
   */
  _showMilestoneLabel(milestoneInfo) {
    // Remove any existing milestone label first
    this._hideMilestoneLabel();

    const style = {
      fontFamily: "Signika",
      fontSize: 12,
      fill: 0xffffff,
      wordWrap: true,
      wordWrapWidth: 150,
    };
    const label = new PIXI.Text(milestoneInfo.name, style);
    label.anchor.set(0.5, 0.5);

    // For short edges, offset perpendicular to avoid covering nodes
    // For longer edges, just position above the midpoint
    const shortEdgeThreshold = 100; // Distance below which we offset
    const dist = milestoneInfo.dist ?? 200;
    const angle = milestoneInfo.angle ?? 0;

    let boxX = milestoneInfo.midX;
    let boxY = milestoneInfo.midY - 25;

    if (dist < shortEdgeThreshold) {
      // Calculate perpendicular offset - move label to the side of the line
      const perpAngle = angle + Math.PI / 2;
      const offsetDist = 45; // Offset distance from the line
      boxX = milestoneInfo.midX + offsetDist * Math.cos(perpAngle);
      boxY = milestoneInfo.midY + offsetDist * Math.sin(perpAngle);
    }

    // Milestone box dimensions with padding
    const padding = 6;
    const boxWidth = label.width + padding * 2;
    const boxHeight = label.height + padding * 2;

    // Draw background with dotted border
    const bg = new PIXI.Graphics();
    bg.beginFill(0x222222, 0.9);
    bg.drawRoundedRect(
      boxX - boxWidth / 2,
      boxY - boxHeight / 2,
      boxWidth,
      boxHeight,
      4,
    );
    bg.endFill();

    // Draw dotted border
    const borderColor = milestoneInfo.isArc ? 0xffa500 : milestoneInfo.color;
    this._drawDottedRect(
      bg,
      boxX - boxWidth / 2,
      boxY - boxHeight / 2,
      boxWidth,
      boxHeight,
      4,
      borderColor,
      3,
      3,
    );

    label.x = boxX;
    label.y = boxY;

    this._layers.labels.addChild(bg);
    this._layers.labels.addChild(label);
    this._activeMilestoneLabel = { bg, label };
  }

  /**
   * Hide the current milestone hover label.
   */
  _hideMilestoneLabel() {
    if (this._activeMilestoneLabel) {
      this._layers.labels.removeChild(this._activeMilestoneLabel.bg);
      this._layers.labels.removeChild(this._activeMilestoneLabel.label);
      this._activeMilestoneLabel.bg.destroy();
      this._activeMilestoneLabel.label.destroy();
      this._activeMilestoneLabel = null;
    }
  }

  /**
   * Show milestone label for a node if it makes a callback with an associated milestone.
   */
  _showMilestoneForNode(node) {
    // Find outgoing edge from this node (where node is the caller/toLogId)
    const edge = this._edges.find((e) => e.toLogId === node.id);
    if (!edge || !edge.milestoneName) return;

    // Find the target node to calculate midpoint
    const targetNode = this._nodes.find((n) => n.id === edge.fromLogId);
    if (!targetNode) return;

    const color = this._getColorForValueId(edge.valueId);
    // Calculate distance and angle for offset
    const dx = targetNode.x - node.x;
    const dy = targetNode.y - node.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    // Position at 40% of the way from caller (node) to target
    const midX = node.x + dx * 0.4;
    const midY = node.y + dy * 0.4;

    this._showMilestoneLabel({
      name: edge.milestoneName,
      isArc: edge.milestoneIsArc,
      color,
      midX,
      midY,
      angle,
      dist,
    });
  }

  /**
   * Start a drag-to-link operation from a node.
   */
  _startLinkDrag(sourceNode, globalX, globalY) {
    this._linkDragState = {
      active: true,
      sourceNodeId: sourceNode.id,
      sourceCenterX: sourceNode.x,
      sourceCenterY: sourceNode.y,
      sourceRadius: sourceNode.radius ?? 24,
    };
    this._updateLinkDragLine(globalX, globalY);
  }

  /**
   * Update the temporary link drag line to follow the cursor.
   */
  _updateLinkDragLine(globalX, globalY) {
    if (!this._linkDragState || !this._viewport) return;

    // Convert global coordinates to viewport local coordinates
    const scale = this._viewport.scale.x;
    const localX = (globalX - this._viewport.x) / scale;
    const localY = (globalY - this._viewport.y) / scale;

    // Calculate angle from source center to cursor
    const dx = localX - this._linkDragState.sourceCenterX;
    const dy = localY - this._linkDragState.sourceCenterY;
    const angle = Math.atan2(dy, dx);

    // Start from edge of source node
    const startX =
      this._linkDragState.sourceCenterX +
      this._linkDragState.sourceRadius * Math.cos(angle);
    const startY =
      this._linkDragState.sourceCenterY +
      this._linkDragState.sourceRadius * Math.sin(angle);

    // Clear and redraw the drag line
    this._layers.dragLine.removeChildren();

    const line = new PIXI.Graphics();
    // PIXI v7 API
    line.lineStyle(3, 0x00ff00, 0.7);
    line.moveTo(startX, startY);
    line.lineTo(localX, localY);

    // Draw arrow head at cursor
    const arrowLen = 12;
    line.moveTo(localX, localY);
    line.lineTo(
      localX - arrowLen * Math.cos(angle - Math.PI / 6),
      localY - arrowLen * Math.sin(angle - Math.PI / 6),
    );
    line.moveTo(localX, localY);
    line.lineTo(
      localX - arrowLen * Math.cos(angle + Math.PI / 6),
      localY - arrowLen * Math.sin(angle + Math.PI / 6),
    );

    this._layers.dragLine.addChild(line);
  }

  /**
   * Cancel the current link drag operation.
   */
  _cancelLinkDrag() {
    if (this._linkDragState) {
      this._linkDragState = null;
      this._layers.dragLine.removeChildren();
    }
  }

  /**
   * Create a callback link between two logs.
   * The source log (the one being dragged) gets a callback link TO the target log.
   * @param {string} sourceNodeId - The log that will have the callback link (dragged FROM)
   * @param {string} targetNodeId - The log being linked TO (dropped ON)
   */
  async _createCallbackLink(sourceNodeId, targetNodeId) {
    const sourceNode = this._nodes.find((n) => n.id === sourceNodeId);
    const targetNode = this._nodes.find((n) => n.id === targetNodeId);
    if (!sourceNode || !targetNode) return;

    const sourceLog = this.actor.items.get(sourceNodeId);
    const targetLog = this.actor.items.get(targetNodeId);
    if (!sourceLog || !targetLog) return;

    const valueItems = getValueItems(this.actor);

    // Find which values are invoked on each log
    const sourceInvoked = new Set();
    const targetInvoked = new Set();
    for (const v of valueItems) {
      const srcStates = getValueStateArray(sourceLog, v.id);
      if (srcStates.some(isValueInvokedState)) sourceInvoked.add(v.id);

      const tgtStates = getValueStateArray(targetLog, v.id);
      if (tgtStates.some(isValueInvokedState)) targetInvoked.add(v.id);
    }

    // Check for common invoked values
    const commonValues = [...sourceInvoked].filter((id) =>
      targetInvoked.has(id),
    );

    let valueId;

    if (commonValues.length > 0) {
      // Common values exist — prefer the target's primary, fallback to first common
      valueId =
        targetNode.primaryValueId &&
        commonValues.includes(targetNode.primaryValueId)
          ? targetNode.primaryValueId
          : commonValues[0];
    } else {
      // No common values — prompt the user to pick a value from the target log
      const targetValueChoices = valueItems.filter((v) =>
        targetInvoked.has(v.id),
      );

      if (targetValueChoices.length === 0) {
        // Target has no invoked values at all — reject
        ui.notifications.warn(
          t("sta-officers-log.flowchart.noCommonValues") ??
            "The target log has no invoked values. Cannot create callback link.",
        );
        return;
      }

      // Build dialog to ask the user which value they used
      const choiceHTML = targetValueChoices
        .map(
          (v) =>
            `<label class="sta-flowchart-value-choice">
              <input type="radio" name="valueId" value="${v.id}" />
              <span>${v.name}</span>
            </label>`,
        )
        .join("");

      const result = await foundry.applications.api.DialogV2.prompt({
        classes: ["sta-officers-log"],
        window: {
          title:
            t("sta-officers-log.flowchart.pickValueTitle") ??
            "Choose Value for Callback",
        },
        content: `
          <p>${t("sta-officers-log.flowchart.pickValueMessage") ?? "These logs share no invoked values. Did you use one of these values from the target log?"}</p>
          <div class="sta-flowchart-value-choices">${choiceHTML}</div>
        `,
        ok: {
          label: t("sta-officers-log.flowchart.useValue") ?? "Use Value",
          callback: (event, button) => {
            const selected = button.form?.elements?.valueId?.value;
            return selected || null;
          },
        },
        rejectClose: false,
      });

      if (!result) {
        // User cancelled or didn't select a value — reject
        return;
      }

      valueId = result;

      // Add the chosen value's state to the source log as "positive" and set as primary
      const currentStates = getValueStateArray(sourceLog, valueId).filter(
        (s) => s !== "unused",
      );
      if (!currentStates.some(isValueInvokedState)) {
        const newStates =
          currentStates.length > 0
            ? [...currentStates, "positive"]
            : ["positive"];
        await sourceLog.update({
          [`system.valueStates.${valueId}`]: newStates,
        });
      }

      // Set the source log's primary value to match
      await sourceLog.setFlag(MODULE_ID, "primaryValueId", valueId);
    }

    // Update the source log with the callback link to the target
    await sourceLog.setFlag(MODULE_ID, "callbackLink", {
      fromLogId: targetNodeId,
      valueId: valueId,
    });

    // Sync used flags on affected logs
    const { syncCallbackTargetUsedFlags } =
      await import("../log/callbackSourceButtons.js");
    await syncCallbackTargetUsedFlags(this.actor);

    ui.notifications.info(
      game.i18n.format("sta-officers-log.flowchart.linkCreated", {
        from: sourceNode.name,
        to: targetNode.name,
      }),
    );

    // Rebuild data and re-render
    this._refreshFlowchart();
  }

  /**
   * Refresh the flowchart data and re-render.
   * Preserves current in-memory positions for existing nodes.
   */
  _refreshFlowchart() {
    // Save current node positions before rebuilding
    const existingPositions = new Map();
    for (const node of this._nodes) {
      existingPositions.set(node.id, { x: node.x, y: node.y });
    }

    const { nodes, edges, arcs } = this._buildFlowchartData();

    // Restore positions for existing nodes
    for (const node of nodes) {
      const existingPos = existingPositions.get(node.id);
      if (existingPos) {
        node.x = existingPos.x;
        node.y = existingPos.y;
        node.hasSavedPosition = true; // Treat as having a position to skip re-layout
      }
    }

    this._nodes = nodes;
    this._edges = edges;
    this._arcs = arcs;
    this._computeLayout();
    this._renderFlowchart();
    this._updateSidebar(this._selectedNodeId);
    this._updateDescriptionSidebar(this._selectedNodeId);
  }

  /**
   * Select a node and update the sidebar.
   * @param {string} nodeId - The node to select
   * @param {boolean} addToSelection - If true, add/toggle in multi-selection (Ctrl+click)
   */
  _selectNode(nodeId, addToSelection = false) {
    if (addToSelection) {
      // Ctrl+click: toggle node in multi-selection
      // If there's a single selection, migrate it to multi-selection first
      if (
        this._selectedNodeId &&
        !this._selectedNodeIds.has(this._selectedNodeId)
      ) {
        this._selectedNodeIds.add(this._selectedNodeId);
      }
      this._selectedNodeId = null;

      // Toggle the clicked node in multi-selection
      if (this._selectedNodeIds.has(nodeId)) {
        this._selectedNodeIds.delete(nodeId);
      } else {
        this._selectedNodeIds.add(nodeId);
      }

      // Re-render and update sidebar
      this._renderFlowchart();
      if (this._selectedNodeIds.size === 1) {
        this._updateSidebar([...this._selectedNodeIds][0]);
        this._updateDescriptionSidebar([...this._selectedNodeIds][0]);
      } else if (this._selectedNodeIds.size > 1) {
        this._updateSidebarMultiSelect(this._selectedNodeIds.size);
        this._updateDescriptionSidebar(null);
      } else {
        this._updateSidebar(null);
        this._updateDescriptionSidebar(null);
      }
    } else {
      // Normal click: single selection, clear multi-select
      const previousId = this._selectedNodeId;
      this._selectedNodeId = nodeId;
      this._selectedNodeIds.clear();

      // Re-render to update selection visuals
      if (previousId !== nodeId) {
        this._renderFlowchart();
        this._updateSidebar(nodeId);
        this._updateDescriptionSidebar(nodeId);
      }
    }
  }

  /**
   * Toggle the Advanced (details) sidebar visibility.
   */
  _toggleAdvancedSidebar(button) {
    const root = this.element;
    if (!root) return;
    const sidebar = root.querySelector('[data-hook="sidebar"]');
    if (!sidebar) return;

    const isHidden = sidebar.hidden;
    sidebar.hidden = !isHidden;

    // Toggle the active class on the toolbar button
    const btn = root.querySelector('[data-action="toggle-advanced"]');
    if (btn) btn.classList.toggle("active", isHidden);
  }

  /**
   * Update sidebar with selected node details and editing controls.
   */
  _updateSidebar(nodeId) {
    const root = this.element;
    if (!root) return;

    const sidebarContent = root.querySelector('[data-hook="sidebar-content"]');
    if (!sidebarContent) return;

    const node = this._nodes.find((n) => n.id === nodeId);
    if (!node) {
      sidebarContent.innerHTML = `<p class="sta-flowchart-sidebar-hint">${t("sta-officers-log.flowchart.selectNodeHint") ?? "Click a node to view details"}</p>`;
      return;
    }

    const log = this.actor?.items.get(nodeId);
    if (!log) return;

    // Get all value items for dropdowns
    const valueItems =
      this.actor?.items.filter((i) => i.type === "value") ?? [];

    // Current primary value
    const currentPrimaryValueId =
      log.getFlag?.(MODULE_ID, "primaryValueId") ?? "";

    // Current arc info
    const arcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
    const isArcEnd = arcInfo?.isArc === true;
    // Arc steps minimum is 3 + completed arc count
    const completedArcCount = this._arcs?.length ?? 0;
    const minArcSteps = 3 + completedArcCount;
    const arcSteps = arcInfo?.steps || minArcSteps;

    // Build primary value select options
    let primaryValueOptionsHtml = '<option value="">- None -</option>';
    for (const v of valueItems) {
      const selected = currentPrimaryValueId === v.id ? "selected" : "";
      primaryValueOptionsHtml += `<option value="${v.id}" ${selected}>${foundry.utils.escapeHTML(v.name)}</option>`;
    }

    // Build value states section
    let valueStatesHtml = "";
    const stateTypes = ["positive", "negative", "challenged"];
    for (const v of valueItems) {
      const currentStates = getValueStateArray(log, v.id).filter(
        (s) => s !== "unused",
      );
      let checkboxesHtml = "";
      for (const state of stateTypes) {
        const checked = currentStates.includes(state) ? "checked" : "";
        const label = state.charAt(0).toUpperCase() + state.slice(1);
        checkboxesHtml += `
          <label class="sta-flowchart-state-checkbox">
            <input type="checkbox" data-value-id="${v.id}" data-state="${state}" ${checked}>
            ${label}
          </label>
        `;
      }
      valueStatesHtml += `
        <div class="sta-flowchart-value-state-row">
          <span class="sta-flowchart-value-name">${foundry.utils.escapeHTML(v.name)}</span>
          <div class="sta-flowchart-state-checkboxes">${checkboxesHtml}</div>
        </div>
      `;
    }

    // Check for callback link
    const callbackLink = log?.getFlag?.(MODULE_ID, "callbackLink") ?? null;
    const hasCallback = Boolean(callbackLink?.fromLogId);
    const callbackTargetLog = hasCallback
      ? this.actor?.items.get(callbackLink.fromLogId)
      : null;
    const callbackTargetName = callbackTargetLog?.name ?? "Unknown";

    // Check if this log is a callback target for other logs
    const incomingCallbacks = this._edges.filter((e) => e.fromLogId === nodeId);

    let callbackHtml = "";
    if (hasCallback) {
      callbackHtml = `
        <p><strong>Callbacks to:</strong> ${callbackTargetName}</p>
      `;
    }

    if (incomingCallbacks.length > 0) {
      const sourceNames = incomingCallbacks
        .map((e) => {
          const sourceNode = this._nodes.find((n) => n.id === e.toLogId);
          return sourceNode?.name ?? "Unknown";
        })
        .join(", ");
      callbackHtml += `<p><strong>Referenced by:</strong> ${sourceNames}</p>`;
    }

    sidebarContent.innerHTML = `
      <div class="sta-flowchart-node-details">
        <h5>${foundry.utils.escapeHTML(node.name)}</h5>
        
        <div class="sta-flowchart-edit-section">
          <label class="sta-flowchart-edit-label">
            ${t("sta-officers-log.flowchart.primaryValue") ?? "Primary Value"}
            <select data-action="set-primary-value" class="sta-flowchart-select">
              ${primaryValueOptionsHtml}
            </select>
          </label>
        </div>

        <div class="sta-flowchart-edit-section">
          <label class="sta-flowchart-edit-checkbox">
            <input type="checkbox" data-action="toggle-arc-complete" ${isArcEnd ? "checked" : ""}>
            ${t("sta-officers-log.flowchart.completesChain") ?? "Completes Chain (Arc End)"}
          </label>
          <div class="sta-flowchart-arc-steps" ${isArcEnd ? "" : 'style="display:none"'}>
            <label class="sta-flowchart-edit-label">
              ${t("sta-officers-log.flowchart.arcSteps") ?? "Arc Steps"}
              <input type="number" data-action="set-arc-steps" min="${minArcSteps}" max="15" value="${arcSteps}" class="sta-flowchart-number-input">
            </label>
          </div>
        </div>

        <div class="sta-flowchart-edit-section">
          <h6 class="sta-flowchart-section-title">${t("sta-officers-log.flowchart.valueStates") ?? "Value States"}</h6>
          <div class="sta-flowchart-value-states">
            ${valueStatesHtml || '<p class="sta-flowchart-no-values">No values on character</p>'}
          </div>
        </div>

        ${callbackHtml}

        <div class="sta-flowchart-edit-section">
          <label class="sta-flowchart-edit-label">
            ${t("sta-officers-log.flowchart.milestone") ?? "Milestone"}
            <select data-action="set-milestone" class="sta-flowchart-select">
              ${this._buildMilestoneOptions(nodeId)}
            </select>
          </label>
        </div>
        
        <div class="sta-flowchart-node-actions">
          <button type="button" class="sta-flowchart-btn" data-action="open-log" data-node-id="${nodeId}">
            <i class="fa-solid fa-external-link-alt"></i> ${t("sta-officers-log.flowchart.openLog") ?? "Open Log"}
          </button>
          <button type="button" class="sta-flowchart-btn sta-flowchart-btn-danger" data-action="delete-log" data-node-id="${nodeId}">
            <i class="fa-solid fa-trash"></i> ${t("sta-officers-log.flowchart.deleteLog") ?? "Delete"}
          </button>
        </div>
      </div>
    `;

    // Attach event listeners
    this._attachSidebarListeners(sidebarContent, nodeId, log);
  }

  /**
   * Update the description sidebar with a rich text editor for the selected node.
   * Uses the <prose-mirror> custom element with toggled mode for view/edit/save.
   */
  async _updateDescriptionSidebar(nodeId) {
    const root = this.element;
    if (!root) return;

    const descContent = root.querySelector('[data-hook="description-content"]');
    if (!descContent) return;

    // Suppress blur-save on outgoing editor before destroying it
    this._suppressDescriptionSave = true;
    descContent.innerHTML = "";
    this._suppressDescriptionSave = false;

    const node = this._nodes.find((n) => n.id === nodeId);
    if (!node) {
      descContent.innerHTML = `<p class="sta-flowchart-sidebar-hint">${t("sta-officers-log.flowchart.selectNodeHint") ?? "Click a node to view details"}</p>`;
      return;
    }

    const log = this.actor?.items.get(nodeId);
    if (!log) return;

    // Get the current description value and ensure it's a string
    let description = log.system?.description;
    if (typeof description !== "string") {
      description = description ? String(description) : "";
    }

    // Enrich HTML for the view mode (resolves links, inline rolls, etc.)
    const enriched = await TextEditor.enrichHTML(description, {
      async: true,
      relativeTo: log,
    });

    // Create <prose-mirror> custom element with toggled mode via factory
    const ProseMirrorElement = customElements.get("prose-mirror");
    const proseMirror = ProseMirrorElement.create({
      name: "system.description",
      toggled: true,
      value: description,
      enriched: enriched || "",
    });
    proseMirror.classList.add("sta-flowchart-description-editor");

    // Listen for save events to persist the description
    proseMirror.addEventListener("change", async () => {
      if (this._suppressDescriptionSave) return;
      const newDescription = proseMirror.value ?? "";
      const currentDescription = log.system?.description ?? "";
      if (newDescription !== currentDescription) {
        await log.update({ "system.description": newDescription });
      }
    });

    descContent.appendChild(proseMirror);

    // --- Info section below the description ---
    const infoSection = document.createElement("div");
    infoSection.className = "sta-flowchart-desc-info";

    // 1. Values used
    const valueItems = getValueItems(this.actor);
    const usedValues = (node.valueIds ?? [])
      .map((vid) => valueItems.find((v) => v.id === vid))
      .filter(Boolean);

    if (usedValues.length) {
      const valuesHtml = usedValues
        .map((v) => {
          const colorIdx = this._valueColors.get(v.id) ?? 0;
          const color = this._getColorForIndex(colorIdx);
          const hex = `#${color.toString(16).padStart(6, "0")}`;
          return `<span class="sta-flowchart-info-value-badge" style="border-color:${hex};color:${hex}">${foundry.utils.escapeHTML(v.name)}</span>`;
        })
        .join("");
      infoSection.innerHTML += `
        <div class="sta-flowchart-info-group">
          <h6 class="sta-flowchart-info-label">${t("sta-officers-log.flowchart.valuesUsed") ?? "Values Used"}</h6>
          <div class="sta-flowchart-info-values">${valuesHtml}</div>
        </div>`;
    }

    // 2. Callback links
    const callbackLink = log.getFlag?.(MODULE_ID, "callbackLink") ?? null;
    const hasCallback = Boolean(callbackLink?.fromLogId);
    const incomingCallbacks = this._edges.filter((e) => e.fromLogId === nodeId);

    if (hasCallback || incomingCallbacks.length > 0) {
      let linksHtml = "";
      if (hasCallback) {
        const targetLog = this.actor?.items.get(callbackLink.fromLogId);
        const targetName = targetLog?.name ?? "Unknown";
        linksHtml += `<p class="sta-flowchart-info-link"><i class="fa-solid fa-arrow-right"></i> ${t("sta-officers-log.flowchart.callbacksTo") ?? "Callbacks to:"} <strong>${foundry.utils.escapeHTML(targetName)}</strong></p>`;
      }
      if (incomingCallbacks.length > 0) {
        const sourceNames = incomingCallbacks
          .map((e) => {
            const srcLog = this.actor?.items.get(e.toLogId);
            return srcLog?.name ?? "Unknown";
          })
          .map((n) => foundry.utils.escapeHTML(n));
        linksHtml += `<p class="sta-flowchart-info-link"><i class="fa-solid fa-arrow-left"></i> ${t("sta-officers-log.flowchart.referencedBy") ?? "Referenced by:"} <strong>${sourceNames.join(", ")}</strong></p>`;
      }
      infoSection.innerHTML += `
        <div class="sta-flowchart-info-group">
          <h6 class="sta-flowchart-info-label">${t("sta-officers-log.flowchart.links") ?? "Links"}</h6>
          ${linksHtml}
        </div>`;
    }

    // Clear callback button (if this log has an outgoing callback)
    if (hasCallback) {
      const clearDiv = document.createElement("div");
      clearDiv.className = "sta-flowchart-info-group";
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className =
        "sta-flowchart-btn sta-flowchart-btn-warning sta-flowchart-btn-sm";
      clearBtn.dataset.action = "clear-callback";
      clearBtn.dataset.nodeId = nodeId;
      clearBtn.innerHTML = `<i class="fa-solid fa-unlink"></i> ${t("sta-officers-log.flowchart.clearCallback") ?? "Clear Callback"}`;
      clearDiv.appendChild(clearBtn);
      infoSection.appendChild(clearDiv);
    }

    // 3. Milestone info
    const milestones =
      this.actor?.items.filter((i) => i.type === "milestone") ?? [];
    const linkedMilestone = milestones.find((ms) => {
      const isArc = !!ms.system?.arc?.isArc;
      const childIds = isArc
        ? getMilestoneChildLogIds(ms)
        : [
            String(ms.system?.childA ?? ""),
            String(ms.system?.childB ?? ""),
          ].filter(Boolean);
      return childIds.includes(nodeId);
    });

    if (linkedMilestone) {
      const msName = foundry.utils.escapeHTML(linkedMilestone.name);
      infoSection.innerHTML += `
        <div class="sta-flowchart-info-group">
          <h6 class="sta-flowchart-info-label">${t("sta-officers-log.flowchart.milestone") ?? "Milestone"}</h6>
          <p class="sta-flowchart-info-milestone"><i class="fa-solid fa-trophy"></i> ${msName}</p>
        </div>`;
    } else if (hasCallback) {
      // Has callback but no milestone — offer to create one
      const createDiv = document.createElement("div");
      createDiv.className = "sta-flowchart-info-group";
      createDiv.innerHTML = `
        <h6 class="sta-flowchart-info-label">${t("sta-officers-log.flowchart.milestone") ?? "Milestone"}</h6>
        <p class="sta-flowchart-info-no-milestone">${t("sta-officers-log.flowchart.noMilestone") ?? "No milestone for this callback."}</p>`;
      const createBtn = document.createElement("button");
      createBtn.type = "button";
      createBtn.className = "sta-flowchart-btn sta-flowchart-btn-sm";
      createBtn.innerHTML = `<i class="fa-solid fa-plus"></i> ${t("sta-officers-log.flowchart.createMilestone") ?? "Create Milestone"}`;
      createBtn.addEventListener("click", () => {
        openNewMilestoneArcDialog(this.actor);
      });
      createDiv.appendChild(createBtn);
      infoSection.appendChild(createDiv);
    }

    if (infoSection.children.length > 0) {
      descContent.appendChild(infoSection);
    }

    // Store reference for potential cleanup
    this._descriptionEditor = proseMirror;
    this._descriptionLogId = nodeId;
  }

  /**
   * Attach event listeners to non-button sidebar controls (form inputs).
   * Buttons are handled by ApplicationV2's actions option.
   */
  _attachSidebarListeners(sidebarContent, nodeId, log) {
    // Primary value select (change event, not handled by actions)
    sidebarContent
      .querySelector('[data-action="set-primary-value"]')
      ?.addEventListener("change", async (event) => {
        const newValueId = event.target.value;
        await this._setPrimaryValue(nodeId, newValueId);
      });

    // Milestone select (change event)
    sidebarContent
      .querySelector('[data-action="set-milestone"]')
      ?.addEventListener("change", async (event) => {
        const milestoneId = event.target.value;
        await this._setMilestoneForLog(nodeId, milestoneId);
      });

    // Arc complete checkbox (change event, not handled by actions)
    sidebarContent
      .querySelector('[data-action="toggle-arc-complete"]')
      ?.addEventListener("change", async (event) => {
        const isChecked = event.target.checked;
        await this._toggleArcComplete(nodeId, isChecked);
        // Show/hide arc steps input
        const stepsDiv = sidebarContent.querySelector(
          ".sta-flowchart-arc-steps",
        );
        if (stepsDiv) {
          stepsDiv.style.display = isChecked ? "" : "none";
        }
      });

    // Arc steps input (change event, not handled by actions)
    sidebarContent
      .querySelector('[data-action="set-arc-steps"]')
      ?.addEventListener("change", async (event) => {
        const steps = parseInt(event.target.value, 10);
        if (steps >= 2 && steps <= 10) {
          await this._setArcSteps(nodeId, steps);
        }
      });

    // Value state checkboxes (change events, not handled by actions)
    sidebarContent
      .querySelectorAll(
        '.sta-flowchart-state-checkboxes input[type="checkbox"]',
      )
      .forEach((checkbox) => {
        checkbox.addEventListener("change", async (event) => {
          const valueId = event.target.dataset.valueId;
          const state = event.target.dataset.state;
          const isChecked = event.target.checked;
          await this._toggleValueState(nodeId, valueId, state, isChecked);
        });
      });
  }

  /**
   * Build <option> HTML for the milestone dropdown for a given log.
   * Finds which milestone currently references this log via childA/childB/arc chain.
   */
  _buildMilestoneOptions(logId) {
    const milestones =
      this.actor?.items.filter((i) => i.type === "milestone") ?? [];
    let currentMilestoneId = "";

    // Find which milestone currently references this log
    for (const ms of milestones) {
      const isArc = !!ms.system?.arc?.isArc;
      const childIds = isArc
        ? getMilestoneChildLogIds(ms)
        : [
            String(ms.system?.childA ?? ""),
            String(ms.system?.childB ?? ""),
          ].filter(Boolean);
      if (childIds.includes(logId)) {
        currentMilestoneId = ms.id;
        break;
      }
    }

    let html = `<option value="">${"- None -"}</option>`;
    for (const ms of milestones) {
      const selected = currentMilestoneId === ms.id ? "selected" : "";
      html += `<option value="${ms.id}" ${selected}>${foundry.utils.escapeHTML(ms.name)}</option>`;
    }
    return html;
  }

  /**
   * Assign a milestone to reference this log (set as childB on the milestone).
   * If clearing, remove this log from the milestone's children.
   */
  async _setMilestoneForLog(logId, milestoneId) {
    // First, clear this log from any existing milestone that references it
    const milestones =
      this.actor?.items.filter((i) => i.type === "milestone") ?? [];
    for (const ms of milestones) {
      if (ms.id === milestoneId) continue;
      const isArc = !!ms.system?.arc?.isArc;
      if (isArc) continue; // Don't modify arc milestones automatically
      const childA = String(ms.system?.childA ?? "");
      const childB = String(ms.system?.childB ?? "");
      if (childA === logId) {
        await ms.update({ "system.childA": "" });
      }
      if (childB === logId) {
        await ms.update({ "system.childB": "" });
      }
    }

    // Now assign the new milestone
    if (milestoneId) {
      const ms = this.actor?.items.get(milestoneId);
      if (ms) {
        await ms.update({ "system.childB": logId });
      }
    }
  }

  /**
   * Set the primary value for a log.
   */
  async _setPrimaryValue(logId, valueId) {
    const log = this.actor?.items.get(logId);
    if (!log) return;

    if (valueId) {
      await log.setFlag(MODULE_ID, "primaryValueId", valueId);
    } else {
      await log.unsetFlag(MODULE_ID, "primaryValueId");
    }
    ui.notifications.info(
      t("sta-officers-log.flowchart.primaryValueUpdated") ??
        "Primary value updated",
    );
  }

  /**
   * Toggle whether a log completes an arc chain.
   */
  async _toggleArcComplete(logId, isComplete) {
    const log = this.actor?.items.get(logId);
    if (!log) return;

    if (isComplete) {
      // Get the primary value to use for the arc
      const primaryValueId = log.getFlag?.(MODULE_ID, "primaryValueId") ?? "";
      const existingArcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? {};

      // Default arc steps is 3 + number of completed arcs
      const completedArcCount = this._arcs?.length ?? 0;
      const defaultSteps = 3 + completedArcCount;

      const arcInfo = {
        isArc: true,
        steps: existingArcInfo.steps || defaultSteps,
        valueId: primaryValueId || existingArcInfo.valueId || "",
        arcLabel: existingArcInfo.arcLabel || "",
      };
      await log.setFlag(MODULE_ID, "arcInfo", arcInfo);
    } else {
      await log.unsetFlag(MODULE_ID, "arcInfo");
    }
    ui.notifications.info(
      t("sta-officers-log.flowchart.arcStatusUpdated") ?? "Arc status updated",
    );
  }

  /**
   * Set the number of steps for an arc.
   */
  async _setArcSteps(logId, steps) {
    const log = this.actor?.items.get(logId);
    if (!log) return;

    const existingArcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? {};
    if (!existingArcInfo.isArc) return;

    // Minimum arc steps is 3 + number of completed arcs
    const completedArcCount = this._arcs?.length ?? 0;
    const minSteps = 3 + completedArcCount;

    const arcInfo = {
      ...existingArcInfo,
      steps: Math.max(minSteps, Math.min(15, steps)),
    };
    await log.setFlag(MODULE_ID, "arcInfo", arcInfo);
    ui.notifications.info(
      t("sta-officers-log.flowchart.arcStepsUpdated") ?? "Arc steps updated",
    );
  }

  /**
   * Toggle a value state for a log.
   */
  async _toggleValueState(logId, valueId, state, isEnabled) {
    const log = this.actor?.items.get(logId);
    if (!log) return;

    const currentStates = getValueStateArray(log, valueId).filter(
      (s) => s !== "unused",
    );
    const valueStates = [...currentStates];

    if (isEnabled) {
      if (!valueStates.includes(state)) {
        valueStates.push(state);
      }
    } else {
      const idx = valueStates.indexOf(state);
      if (idx > -1) {
        valueStates.splice(idx, 1);
      }
    }

    // Update the log
    await log.update({
      [`system.valueStates.${valueId}`]:
        valueStates.length > 0 ? valueStates : null,
    });
    ui.notifications.info(
      t("sta-officers-log.flowchart.valueStateUpdated") ??
        "Value state updated",
    );
  }

  /**
   * Clear the callback link from a log.
   */
  async _clearCallbackLink(logId) {
    const log = this.actor?.items.get(logId);
    if (!log) return;

    await log.unsetFlag(MODULE_ID, "callbackLink");

    // Sync used flags on affected logs
    const { syncCallbackTargetUsedFlags } =
      await import("../log/callbackSourceButtons.js");
    await syncCallbackTargetUsedFlags(this.actor);

    ui.notifications.info(
      t("sta-officers-log.flowchart.callbackCleared") ??
        "Callback link cleared",
    );
    // Live update hook will refresh the flowchart
  }

  /**
   * Confirm and delete a log.
   */
  async _confirmDeleteLog(logId) {
    const log = this.actor?.items.get(logId);
    if (!log) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      classes: ["sta-officers-log"],
      window: {
        title: t("sta-officers-log.confirmDelete.title") ?? "Delete",
      },
      content: `<p>${t("sta-officers-log.flowchart.confirmDeleteLog") ?? "Are you sure you want to delete this log?"}</p>`,
      yes: { label: t("sta-officers-log.confirmDelete.delete") ?? "Delete" },
      no: { label: t("sta-officers-log.confirmDelete.cancel") ?? "Cancel" },
    });

    if (confirmed) {
      // Clear callback links on other logs that point to or from this log
      const allLogs = this.actor.items.filter((i) => i.type === "log");
      for (const otherLog of allLogs) {
        if (otherLog.id === logId) continue;
        const link = otherLog.getFlag?.(MODULE_ID, "callbackLink") ?? null;
        if (link?.fromLogId === logId) {
          await otherLog.unsetFlag(MODULE_ID, "callbackLink");
        }
      }

      // Clear the deleted log's own callback link (so its target gets unmarked)
      if (log.getFlag?.(MODULE_ID, "callbackLink")) {
        await log.unsetFlag(MODULE_ID, "callbackLink");
      }

      // Delete the log
      await this.actor.deleteEmbeddedDocuments("Item", [logId]);
      this._selectedNodeId = null;

      // Sync used flags so targets are correctly marked unused
      const { syncCallbackTargetUsedFlags } =
        await import("../log/callbackSourceButtons.js");
      await syncCallbackTargetUsedFlags(this.actor);
    }
  }

  /**
   * Draw log names to the right of nodes.
   */
  _renderLabels() {
    if (!this._nodes.length || !this._layers.labels) return;

    for (const node of this._nodes) {
      const x = node.x + (node.radius ?? 24) + 10;
      const y = node.y;
      const isSelected =
        this._selectedNodeId === node.id || this._selectedNodeIds.has(node.id);

      // Create text with background (PIXI v7 API)
      const text = new PIXI.Text(node.name, {
        fontFamily: "sans-serif",
        fontSize: 13,
        fill: isSelected ? 0xffffff : 0xdddddd,
      });
      text.anchor.set(0, 0.5);
      text.x = x;
      text.y = y;

      // Background rectangle (PIXI v7 API)
      const bg = new PIXI.Graphics();
      const padding = 2;
      bg.beginFill(0x000000, 0.7);
      bg.drawRoundedRect(
        x - padding,
        y - text.height / 2 - padding,
        text.width + padding * 2,
        text.height + padding * 2,
        3,
      );
      bg.endFill();

      this._layers.labels.addChild(bg);
      this._layers.labels.addChild(text);
    }
  }

  /**
   * Create a new log item on the actor.
   * Uses Foundry's createEmbeddedDocuments API for proper document creation.
   */
  async _createNewLog() {
    if (!this.actor) return;

    const defaultName =
      t("sta-officers-log.flowchart.newLogName") ?? "New Mission Log";

    // Create the log item
    const created = await this.actor.createEmbeddedDocuments("Item", [
      {
        name: defaultName,
        type: "log",
      },
    ]);

    if (created?.length > 0) {
      ui.notifications.info(`Created: ${created[0].name}`);
      // The live update hook will refresh the flowchart
    }
  }

  /**
   * Reset the viewport pan and zoom to default, and clear saved positions.
   */
  _resetLayout() {
    if (!this._viewport) return;

    this._viewport.x = 0;
    this._viewport.y = 0;
    this._viewport.scale.set(1);

    // Clear saved position flags so nodes get fresh positions
    for (const node of this._nodes) {
      node.hasSavedPosition = false;
    }

    // Mark as dirty since positions changed
    this._markDirty();

    // Re-compute layout ignoring saved positions and re-render
    this._computeLayout({ ignoreSavedPositions: true });
    this._renderFlowchart();
  }

  /**
   * Zoom the viewport by a factor.
   */
  _zoomViewport(factor) {
    if (!this._viewport) return;

    const oldScale = this._viewport.scale.x;
    const newScale = Math.max(0.25, Math.min(3, oldScale * factor));

    // Zoom toward center of canvas
    const centerX = (this._pixiApp?.screen.width ?? 800) / 2;
    const centerY = (this._pixiApp?.screen.height ?? 600) / 2;

    const worldPos = {
      x: (centerX - this._viewport.x) / oldScale,
      y: (centerY - this._viewport.y) / oldScale,
    };

    this._viewport.scale.set(newScale);
    this._viewport.x = centerX - worldPos.x * newScale;
    this._viewport.y = centerY - worldPos.y * newScale;
  }

  /**
   * Fit all nodes in the viewport.
   */
  _fitViewport() {
    if (!this._viewport || !this._pixiApp || !this._nodes.length) return;

    // Calculate bounding box of all nodes
    const padding = 60;
    const nodeRadius = this._nodes[0]?.radius ?? 24;

    let minX = Infinity,
      minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;

    for (const node of this._nodes) {
      minX = Math.min(minX, node.x - nodeRadius);
      minY = Math.min(minY, node.y - nodeRadius);
      maxX = Math.max(maxX, node.x + nodeRadius + 100); // Extra space for labels
      maxY = Math.max(maxY, node.y + nodeRadius);
    }

    const contentWidth = maxX - minX + padding * 2;
    const contentHeight = maxY - minY + padding * 2;

    const screenWidth = this._pixiApp.screen.width;
    const screenHeight = this._pixiApp.screen.height;

    // Calculate scale to fit content
    const scaleX = screenWidth / contentWidth;
    const scaleY = screenHeight / contentHeight;
    const scale = Math.min(scaleX, scaleY, 2); // Don't zoom in more than 2x

    // Center the content
    this._viewport.scale.set(scale);
    this._viewport.x =
      (screenWidth - contentWidth * scale) / 2 - (minX - padding) * scale;
    this._viewport.y =
      (screenHeight - contentHeight * scale) / 2 - (minY - padding) * scale;
  }

  /**
   * Register Foundry hooks to refresh the flowchart when items change.
   */
  _registerUpdateHooks() {
    const actorId = this.actor?.id;
    if (!actorId) return;

    // Clean up any existing hooks first
    for (const hook of this._hookIds) {
      try {
        Hooks.off(hook.name, hook.id);
      } catch (_) {
        // ignore
      }
    }
    this._hookIds = [];

    // Debounce refresh to avoid multiple rapid updates
    let refreshTimeout = null;
    const debouncedRefresh = () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => {
        this._refreshFlowchart();
      }, 100);
    };

    // Listen for item updates on this actor
    const updateHookId = Hooks.on("updateItem", (item) => {
      if (item.actor?.id !== actorId) return;
      if (item.type === "log" || item.type === "value") {
        debouncedRefresh();
      }
    });
    this._hookIds.push({ name: "updateItem", id: updateHookId });

    // Listen for item creation on this actor
    const createHookId = Hooks.on("createItem", (item) => {
      if (item.actor?.id !== actorId) return;
      if (item.type === "log" || item.type === "value") {
        debouncedRefresh();
      }
    });
    this._hookIds.push({ name: "createItem", id: createHookId });

    // Listen for item deletion on this actor
    const deleteHookId = Hooks.on("deleteItem", (item) => {
      if (item.actor?.id !== actorId) return;
      if (item.type === "log" || item.type === "value") {
        // Clear selection if deleted item was selected
        if (item.id === this._selectedNodeId) {
          this._selectedNodeId = null;
        }
        debouncedRefresh();
      }
    });
    this._hookIds.push({ name: "deleteItem", id: deleteHookId });
  }

  /**
   * Mark the flowchart as having unsaved position changes.
   */
  _markDirty() {
    this._isDirty = true;
    this._updateSaveButtonState();
  }

  /**
   * Update the save button visual state.
   */
  _updateSaveButtonState() {
    const saveBtn = this.element?.querySelector(
      '[data-action="save-positions"]',
    );
    if (saveBtn) {
      if (this._isDirty) {
        saveBtn.classList.add("sta-flowchart-btn-dirty");
      } else {
        saveBtn.classList.remove("sta-flowchart-btn-dirty");
      }
    }
  }

  /**
   * Save node positions to their log item flags.
   */
  async _savePositions() {
    if (!this.actor) return;

    const updates = [];
    for (const node of this._nodes) {
      const log = this.actor.items.get(node.id);
      if (!log) continue;

      // Save position as a flag
      updates.push(
        log.setFlag(MODULE_ID, "flowchartPosition", {
          x: node.x,
          y: node.y,
        }),
      );
    }

    // Save arc column positions
    for (const col of this._arcColumns) {
      const log = this.actor.items.get(col.arcId);
      if (!log) continue;

      updates.push(
        log.setFlag(MODULE_ID, "flowchartColumnPosition", {
          x: col.x,
          y: col.y,
        }),
      );
    }

    await Promise.allSettled(updates);

    this._isDirty = false;
    this._updateSaveButtonState();

    ui.notifications.info(
      t("sta-officers-log.flowchart.positionsSaved") ?? "Positions saved",
    );
  }

  async close(options) {
    // Check for unsaved changes
    if (this._isDirty) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        classes: ["sta-officers-log"],
        window: {
          title:
            t("sta-officers-log.flowchart.unsavedChangesTitle") ??
            "Unsaved Changes",
        },
        content: `<p>${t("sta-officers-log.flowchart.unsavedChangesMessage") ?? "You have unsaved position changes. Are you sure you want to close without saving?"}</p>`,
        yes: {
          label:
            t("sta-officers-log.flowchart.closeWithoutSaving") ??
            "Close Without Saving",
        },
        no: { label: t("sta-officers-log.flowchart.cancel") ?? "Cancel" },
      });

      if (!confirmed) return;
    }

    // Clean up resize observer
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    // Clean up PixiJS
    if (this._pixiApp) {
      this._pixiApp.destroy(true, { children: true });
      this._pixiApp = null;
    }

    // Clean up hooks
    for (const hook of this._hookIds) {
      try {
        Hooks.off(hook.name, hook.id);
      } catch (_) {
        // ignore
      }
    }
    this._hookIds = [];

    return super.close(options);
  }
}
