// Settings menu for OsmAnd Navigation
// appears under Settings -> Apps -> OsmAnd Nav
(function(back) {
  var FILE = "osmandnav.json";
  var settings = Object.assign({
    buzz: true,
    metric: false,     // false = imperial (ft/mi), true = metric (m/km)
    backlight: 2,      // 0=always off, 1=always on, 2=auto after hour
    backlightHour: 18
  }, require("Storage").readJSON(FILE, true) || {});
  function save() { require("Storage").writeJSON(FILE, settings); }
  E.showMenu({
    "": { title: "OsmAnd Nav", back: back },
    "Units": {
      value: !!settings.metric,
      format: function(v) { return v ? "Metric" : "Imperial"; },
      onchange: function(v) { settings.metric = v; save(); }
    },
    "Vibrate": {
      value: !!settings.buzz,
      onchange: function(v) { settings.buzz = v; save(); }
    },
    "Backlight": {
      value: settings.backlight,
      min: 0, max: 2,
      format: function(v) { return ["Always off", "Always on", "Auto"][v]; },
      onchange: function(v) { settings.backlight = v; save(); }
    },
    "Auto after": {
      value: settings.backlightHour,
      min: 14, max: 23,
      format: function(v) { return v + ":00"; },
      onchange: function(v) { settings.backlightHour = v; save(); }
    }
  });
})
