# OsmAnd Navigation

Turn-by-turn navigation display for [OsmAnd](https://osmand.net/), delivered
over Bluetooth by [Gadgetbridge](https://gadgetbridge.org/).

## Features

- Street name of the next turn, auto-sized and word-wrapped to fit the screen
- Distance in imperial units (feet under 1000 ft, then miles), converted on
  the watch from the raw meters Gadgetbridge sends
- Turn arrows drawn on the fly (turns, keeps, u-turns, roundabouts with exit
  number)
- Distance turns yellow under 1 mile and red under 0.5 miles
- "then:" preview of the following turn when OsmAnd announces chained
  instructions
- Bottom bar: current time
- Screen stays awake while the app is open; backlight only turns on after a
  configurable hour (default 18:00) - the Bangle's sunlight-readable screen
  doesn't need it during the day
- Vibrates when a new instruction arrives

## Requirements

1. **Gadgetbridge** (Bangle.js edition) paired with the watch
2. The **Android Integration** app installed on the watch (default with
   Gadgetbridge setup)
3. **OsmAnd** with navigation started and **voice guidance enabled** -
   instructions are delivered via OsmAnd's voice prompts, so if voice
   guidance is off, no street names arrive. You can mute the phone's media
   volume; the prompts still fire. In Gadgetbridge's OsmAnd settings, allow
   forwarding navigation instructions.

Open the app, start a route, and instructions appear as OsmAnd announces
them. Press the button to exit.

## Configuration

On the watch: Settings -> Apps -> OsmAnd Nav

- **Vibrate** - buzz when a new instruction arrives (default on)
- **Backlight** - Always off / Always on / Auto (on after a chosen hour,
  default 18:00). The screen itself always stays awake while the app is open.

For testing, set `DEMO = true` at the top of `osmandnav.app.js` to cycle fake
instructions (works in the Web IDE emulator).

## Known limitations

- English voice prompts only: street names are parsed from OsmAnd's spoken
  text, using the grammar of OsmAnd's English TTS templates
- ETA / time remaining is not shown because Gadgetbridge's OsmAnd integration
  does not transmit it
- The street text updates when OsmAnd fires a voice prompt; the distance
  updates continuously
