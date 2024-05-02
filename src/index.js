/* 
TODO: request permission on iphone (https://stackoverflow.com/a/58685549)
TODO: add more sensor using SensorAPI https://developer.mozilla.org/en-US/docs/Web/API/Sensor_APIs
TODO: add audio or video features?
*/
import "bootstrap";
import "@fortawesome/fontawesome-free/css/all.css";
import "bootstrap/dist/css/bootstrap.css";
import "./styles.scss";
import edgeML from "edge-ml";
import MobileDetect from "mobile-detect";

/* evalutate property path separated by "." */
function* getValuesBySelectors(obj, selectors) {
  for (const selector of selectors) {
    const properties = selector.split(".");
    let value = obj;

    for (const property of properties) {
      if (typeof value === "object" && property in value) {
        value = value[property];
      } else {
        // Property not found, yield null
        value = null;
        break;
      }
    }

    yield [selector, value];
  }
}

document.getElementById("subject").value = Math.floor(
  (1 + Math.random()) * 0x10000
).toString(16);

var defaultTags = {};

const mobile = new MobileDetect(window.navigator.userAgent);

if (mobile.mobile()) {
  defaultTags.mobile = mobile.mobile();
}

if (mobile.userAgent()) {
  defaultTags.browser = mobile.userAgent();
}

var sensors = {
  deviceorientation: {
    keys: ["alpha", "beta", "gamma"],
    listener: function (/** @type {DeviceOrientationEvent} */ evt) {
      record(
        evt.type,
        Object.fromEntries(getValuesBySelectors(evt, sensors[evt.type].keys)),
        evt.timeStamp + performance.timeOrigin
      );
    },
  },
  devicemotion: {
    keys: [
      "acceleration.x",
      "acceleration.y",
      "acceleration.z",
      "accelerationIncludingGravity.x",
      "accelerationIncludingGravity.y",
      "accelerationIncludingGravity.z",
      "rotationRate.alpha",
      "rotationRate.beta",
      "rotationRate.gamma",
    ],
    listener: function (/** @type {DeviceMotionEvent} */ evt) {
      record(
        evt.type,
        Object.fromEntries(getValuesBySelectors(evt, sensors[evt.type].keys)),
        evt.timeStamp + performance.timeOrigin
      );
    },
  },
};

async function start_recording() {
  for (var [sensor, fun] of Object.entries(sensors)) {
    defaultTags;
    fun.collector = await edgeML.datasetCollector(
      "https://edge-ml-beta.dmz.teco.edu", // Backend-URL
      "30453cc6e632f6eab0adeb6eaf6250e2", // API-Key
      sensor, // Name for the dataset
      false, // False to provide own timestamps
      fun.keys, // Name of the time-series to create in the dataset
      Object.assign(
        {
          participantId: document.getElementById("subject").value,
          activity: document.getElementById("label").value,
        },
        defaultTags
      ),
      "activity_" + document.getElementById("label").value
    );

    window.addEventListener(sensor, fun.listener, true);
  }
}

async function stop_recording() {
  for (const [sensor, fun] of Object.entries(sensors)) {
    window.removeEventListener(sensor, fun.listener, true);
    await fun.collector.onComplete();
  }
}

function record(eventtype, fields, eventtime) {
  // time at which the event happend
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) {
      sensors[eventtype].collector.addDataPoint(
        Math.floor(eventtime),
        key,
        value
      );
    }
  }
}

// Wir schalten einen Timer an/aus mit der checkbox
document.getElementById("record").onchange = function () {
  if (this.checked) {
    start_recording();
    document.getElementById("debug").innerHTML = "Recording.";
  } else {
    stop_recording();
    document.getElementById("debug").innerHTML = "Not recording.";
  }
};
