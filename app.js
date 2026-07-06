/* OsmAnd Navigation - Bangle.js 2 turn-by-turn display
 * for OsmAnd via Gadgetbridge (Android Integration app required)
 *
 * - Imperial units (ft/mi) converted on-watch
 * - Street name extracted from OsmAnd's voice-prompt text, auto-sized + wrapped
 * - Drawn turn arrows, color-coded distance (yellow <1mi, red <0.5mi)
 * - "then" preview of the following turn
 * - Current time in the bottom bar
 * - Screen always awake; backlight always on/off/scheduled (see Settings app)
 * - Buzz on new instruction (toggle in Settings app)
 *
 * TESTING: set DEMO = true and upload to RAM in the Web IDE (emulator works).
 * Tap to advance instructions, press the button to exit.
 */

var DEMO = false;         // true = cycle fake nav data for testing

// user settings (edit in Settings -> Apps -> OsmAnd Nav)
var settings = Object.assign({
  buzz: true,
  backlight: 2,      // 0=always off, 1=always on, 2=auto after backlightHour
  backlightHour: 18
}, require("Storage").readJSON("osmandnav.json", true) || {});

var current;              // last nav message received
var lastInstrKey = "";    // for change detection (buzz)

// ---------- unit conversion ----------
// Gadgetbridge sends distance as "<meters>m" (string) from OsmAnd
function distMeters(d) {
  if (typeof d == "string") return parseInt(d, 10);
  if (typeof d == "number") return d;
  return NaN;
}

function fmtDistance(d) {
  var m = distMeters(d);
  if (isNaN(m)) return null;
  var ft = m * 3.28084;
  if (ft < 1000) {
    var r = (ft < 200) ? 10 : 50; // round for stability
    return { num: Math.round(ft / r) * r, unit: "ft" };
  }
  var mi = m / 1609.344;
  if (mi < 10) return { num: mi.toFixed(1), unit: "mi" };
  return { num: Math.round(mi), unit: "mi" };
}

// ---------- instruction cleanup ----------
// Gadgetbridge forwards OsmAnd's *voice prompt* text. Per OsmAnd's en_tts.js
// templates, street names only ever follow: onto | on | toward | to
function extractStreet(s) {
  var low = " " + s.toLowerCase() + " ";
  var preps = [" onto ", " on ", " toward ", " to "];
  for (var i = 0; i < preps.length; i++) {
    var idx = low.lastIndexOf(preps[i]);
    if (idx >= 0)
      return s.substr(idx - 1 + preps[i].length).trim().replace(/[.\s]+$/, "");
  }
  return "";
}

function cap(s) { return s.length ? s[0].toUpperCase() + s.slice(1) : s; }

// abbreviate common road-type words so more fits on screen
var ABBREV = {
  street:"St", avenue:"Ave", road:"Rd", boulevard:"Blvd", drive:"Dr",
  lane:"Ln", court:"Ct", circle:"Cir", highway:"Hwy", parkway:"Pkwy",
  place:"Pl", terrace:"Ter", trail:"Trl", square:"Sq", crossing:"Xing",
  expressway:"Expy", freeway:"Fwy", turnpike:"Tpke", junction:"Jct",
  north:"N", south:"S", east:"E", west:"W",
  northeast:"NE", northwest:"NW", southeast:"SE", southwest:"SW"
};
function abbrev(s) {
  return s.split(" ").map(function(w) {
    var p = /[.,]$/.test(w) ? w.slice(-1) : "";
    var a = ABBREV[(p ? w.slice(0, -1) : w).toLowerCase()];
    return a ? a + p : w;
  }).join(" ");
}

// returns { main: "street/instruction", next: "following turn or undefined" }
function cleanInstr(s) {
  if (!s) return { main: s };
  var orig = s.trim();
  s = orig;
  // status prompts (no street info) - from OsmAnd en_tts.js dictionary
  if (/reached your (intermediate )?destination/i.test(s)) return { main: "Destination" };
  if (/off the route/i.test(s)) return { main: "OFF ROUTE" };
  if (/back on the route/i.test(s)) return { main: "Back on route" };
  if (/g ?p ?s signal lost/i.test(s)) return { main: "GPS lost" };
  if (/g ?p ?s signal recovered/i.test(s)) return { main: "GPS OK" };
  if (/^attention/i.test(s)) return { main: orig }; // speed cam etc
  // drop appended arrival/waypoint clauses
  s = s.replace(/\s+and (arrive at|pass) .*/i, "");
  // split off the chained "then ..." command -> preview
  var next;
  var tm = s.match(/,?\s+then\s+(.*)$/i);
  if (tm) {
    s = s.substr(0, tm.index);
    var n = tm[1].replace(/\s+and (arrive at|pass) .*/i, "");
    next = extractStreet(n) || n.replace(/[.\s]+$/, "");
    next = abbrev(cap(next));
  }
  // roundabout: "take the second exit onto X" (word ordinals per en_tts.js)
  var ex = s.match(/take the (\w+) exit/i);
  var street = abbrev(cap(extractStreet(s)));
  if (ex) {
    var ord = {first:"1",second:"2",third:"3",fourth:"4",fifth:"5",sixth:"6",
      seventh:"7",eighth:"8",ninth:"9",tenth:"10",eleventh:"11",twelfth:"12"
      }[ex[1].toLowerCase()] || ex[1];
    return { main: "Exit " + ord + (street ? ": " + street : ""), next: next };
  }
  if (street) return { main: street, next: next };
  // no street in prompt: strip the leading distance clause, keep the command
  s = s.replace(/^(in|after)\s[^,]+,\s*/i, "").replace(/[.\s]+$/, "").trim();
  if (/u ?-?turn/i.test(s)) return { main: "U-turn", next: next };
  return { main: s.length ? cap(s) : orig, next: next };
}

// ---------- arrow drawing ----------
var ARROW = [0,-28, 18,-6, 8,-6, 8,28, -8,28, -8,-6, -18,-6];

function rotPoly(poly, ang, cx, cy, scale) {
  var s = Math.sin(ang) * scale, c = Math.cos(ang) * scale, out = [];
  for (var i = 0; i < poly.length; i += 2) {
    out.push(cx + poly[i] * c - poly[i+1] * s);
    out.push(cy + poly[i] * s + poly[i+1] * c);
  }
  return out;
}

var DEG = Math.PI / 180;
var ACTION_ANGLE = {
  "continue": 0,
  "left": -90*DEG,        "right": 90*DEG,
  "left_slight": -45*DEG, "right_slight": 45*DEG,
  "left_sharp": -135*DEG, "right_sharp": 135*DEG,
  "keep_left": -30*DEG,   "keep_right": 30*DEG
};

function drawAction(action, cx, cy) {
  g.setColor(g.theme.fg);
  if (action in ACTION_ANGLE) {
    g.fillPoly(rotPoly(ARROW, ACTION_ANGLE[action], cx, cy, 1.05), true);
    return;
  }
  if (action && action.startsWith("roundabout")) {
    g.fillCircle(cx, cy, 20);
    g.setColor(g.theme.bg).fillCircle(cx, cy, 11);
    g.setColor(g.theme.fg);
    var dir = action.endsWith("left") ? -90*DEG :
              action.endsWith("right") ? 90*DEG :
              action.endsWith("uturn") ? 180*DEG : 0;
    var stub = [0,-36, 11,-20, -11,-20];
    g.fillPoly(rotPoly(stub, dir, cx, cy, 1), true);
    return;
  }
  if (action && action.startsWith("uturn")) {
    var mir = action.endsWith("left") ? -1 : 1;
    g.fillRect(cx-15*mir, cy-18, cx-6*mir, cy+26);
    g.fillRect(cx+6*mir, cy-18, cx+15*mir, cy+8);
    g.fillRect(cx-15*mir, cy-26, cx+15*mir, cy-11);
    g.fillPoly([cx+10*mir, cy+28, cx+(10-13)*mir, cy+7, cx+(10+13)*mir, cy+7], true);
    return;
  }
  g.setFont("Vector", 20).setFontAlign(0, 0);
  g.drawString(action == "finish" ? "FINISH" :
               action == "offroute" ? "OFF\nROUTE" : "?", cx, cy);
}

// ---------- rendering ----------
function draw() {
  g.reset().clearRect(0, 0, g.getWidth()-1, g.getHeight()-1);
  var W = g.getWidth();
  if (!current || !current.instr) {
    g.setFont("Vector", 22).setFontAlign(0, 0);
    g.drawString("Waiting for\nnavigation...", W/2, 70);
    g.setFont("6x8").drawString("Start a route in OsmAnd", W/2, 120);
    drawBottom();
    return;
  }
  var ci = cleanInstr(current.instr);

  // --- street name: auto-size + wrap into top band ---
  var bandH = 66;
  g.setColor(g.theme.bg2).fillRect(0, 0, W-1, bandH-1);
  g.setColor(g.theme.fg2);
  var sizes = [32, 28, 24, 20, 16, 14], lines, size;
  for (var i = 0; i < sizes.length; i++) {
    size = sizes[i];
    g.setFont("Vector", size);
    lines = g.wrapString(ci.main, W - 8);
    if (lines.length * size <= bandH - 6) break;
  }
  var maxLines = Math.floor((bandH - 6) / size);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines-1] += "...";
  }
  g.setFontAlign(0, -1);
  var y = (bandH - lines.length * size) / 2;
  lines.forEach(function(l) { g.drawString(l, W/2, y); y += size; });

  // --- middle: arrow left, distance right (color-coded) ---
  drawAction(current.action, 44, 102);
  var d = fmtDistance(current.distance);
  if (d) {
    var m = distMeters(current.distance);
    var ds = "" + d.num;
    var fs = ds.length > 3 ? 34 : 44;
    g.setFont("Vector", fs);
    var tw = g.stringWidth(ds), cy = 96;
    var badge = null; // [bg, text]
    if (!isNaN(m)) {
      if (m < 805) badge = ["#f00", "#fff"];       // < 0.5 mi
      else if (m < 1609) badge = ["#ff0", "#000"]; // < 1 mi
    }
    if (badge) {
      g.setColor(badge[0]).fillRect(W-14-tw, cy-fs/2-2, W-2, cy+fs/2+2);
      g.setColor(badge[1]);
    } else g.setColor(g.theme.fg);
    g.setFontAlign(1, 0).drawString(ds, W-8, cy);
    g.setColor(g.theme.fg).setFont("Vector", 20);
    g.drawString(d.unit, W-8, cy + fs/2 + 14);
  }

  // --- "then" preview of the following turn ---
  if (ci.next) {
    g.setColor(g.theme.fg).setFont("Vector", 14).setFontAlign(0, 1);
    var nx = "then: " + ci.next;
    while (g.stringWidth(nx) > W-4 && nx.length > 8)
      nx = nx.slice(0, -4) + "...";
    g.drawString(nx, W/2, g.getHeight() - 28);
  }

  drawBottom();
}

function timeStr() {
  var d = new Date();
  try { return require("locale").time(d, 1).trim(); }
  catch(e) {
    return d.getHours() + ":" + ("0" + d.getMinutes()).substr(-2);
  }
}

function drawBottom() {
  var W = g.getWidth(), H = g.getHeight();
  g.reset().clearRect(0, H - 26, W - 1, H - 1);
  g.setFont("Vector", 22);
  g.setFontAlign(-1, 1).drawString(timeStr(), 4, H - 2);
}

// ---------- nav message handling ----------
function onNav(e) {
  if (!e.instr) { // navigation stopped
    current = undefined;
    lastInstrKey = "";
    draw();
    return;
  }
  var key = (e.action || "") + "|" + (e.instr || "");
  var changed = key != lastInstrKey;
  lastInstrKey = key;
  current = e;
  draw();
  if (settings.buzz && changed) {
    Bangle.buzz(200).then(function() {
      return new Promise(function(r) { setTimeout(r, 150); });
    }).then(function() { Bangle.buzz(200); });
  }
}

// intercept Gadgetbridge packets; pass everything except nav through
var oldGB = global.GB;
global.GB = function(e) {
  if (e && e.t == "nav") return onNav(e);
  if (oldGB) oldGB(e);
};

// ---------- setup ----------
// screen stays awake and unlocked; backlight only during the night window
Bangle.setLCDTimeout(0);
Bangle.setLCDPower(1);
function updateBacklight() {
  var on = settings.backlight == 1 || (settings.backlight == 2 &&
    new Date().getHours() >= settings.backlightHour);
  Bangle.setLCDBrightness(on ? 1 : 0);
}
updateBacklight();

// refresh clock + backlight at the top of every minute
function minuteTick() {
  updateBacklight();
  drawBottom();
  setTimeout(minuteTick, 60000 - (Date.now() % 60000));
}
setTimeout(minuteTick, 60000 - (Date.now() % 60000));

var demoIdx = 0;
var demoData = [
  {t:"nav", instr:"In 500 feet, turn left onto Elm Ave, then turn right onto Oak St", distance:"152m", action:"left"},
  {t:"nav", instr:"In a fourth of a mile, take the next left on Chatterson Rd.", distance:"400m", action:"left_slight"},
  {t:"nav", instr:"Turn slightly right onto I-29 toward Fargo", distance:"12345m", action:"right_slight"},
  {t:"nav", instr:"In 600 feet, enter the roundabout, and take the second exit onto High St", distance:"180m", action:"roundabout_right"},
  {t:"nav", instr:"In 300 feet, make a U turn on Pennsylvania Ave", distance:"90m", action:"uturn_left"},
  {t:"nav", instr:"Turn right onto Main St and arrive at your destination", distance:"30m", action:"finish"}
];
function demoNext() { onNav(demoData[demoIdx++ % demoData.length]); }
if (DEMO) {
  var demoTimer = setInterval(demoNext, 3000);
}

Bangle.setUI({
  mode: "custom",
  btn: function() { load(); }, // button exits to clock
  touch: function() { if (DEMO) demoNext(); }
});

E.on("kill", function() {
  global.GB = oldGB;
  Bangle.setLCDTimeout(10);
  var s = require("Storage").readJSON("setting.json", 1) || {};
  Bangle.setLCDBrightness(s.brightness === undefined ? 1 : s.brightness);
});

draw();
if (DEMO) demoNext();
