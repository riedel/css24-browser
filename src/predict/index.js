import { interpolateLinear } from './interpolation';
import { extractSome, objToMap, arrToVector } from "./fel";

function cache(fn){
    var NO_RESULT = Symbol("cache");
    var res = NO_RESULT;
    return function () {
        if(res === NO_RESULT) return (res = fn.apply(this, arguments));
        return res;
    };
}

export const PredictorError = class PredictorError extends Error {}

// max number (STORE_MAX_DATAPOINT_FACTOR * windowSize) of unmerged datapoints to store in the store, rest is pruned
const STORE_MAX_DATAPOINT_FACTOR = 10;

/**
 * @namespace
 * @property {(input: number[]) => number[]} predictor 
 * @property {string[]} sensors 
 * @property {number} windowSize if positive, n last merged entries are used as a window, if negative, the absolute value is used as the window length in milliseconds
 * @property {string[]} labels 
 * @property {{ center: { [featureName: string]: number }, scale: { [featureName: string]: number } }} scaler
 */
export const Predictor = class Predictor {
    /**
     * Predictor
     * @param {(input: number[]) => number[]} predictor 
     * @param {string[]} sensors 
     * @param {number} windowSize if positive, n last merged entries are used as a window, if negative, the absolute value is used as the window length in milliseconds
     * @param {string[]} labels 
     * @param {{ center: { [featureName: string]: number }, scale: { [featureName: string]: number } }} scaler 
     * @param {{ windowingMode: "time" | "sample" }} options
     */
    constructor(predictor, sensors, windowSize, labels, scaler, { windowingMode = "sample" } = {}) {
        /** @type {(input: number[]) => number[]} */
        this.predictor = predictor;
        /** @type {string[]} */
        this.sensors = sensors;
        /** @type {number} */
        this.windowSize = Math.abs(windowSize);
        /** @type {string[]} */
        this.labels = labels; 
        /** @type {{ center: { [featureName: string]: number }, scale: { [featureName: string]: number } }} */
        this.scaler = scaler;
        
        /** @type {boolean} */
        this.windowModeMs = windowSize < 0 || windowingMode === "time"
        this.lastPruneTime = 0;
        this.lastAddTime = 0;

        /** @type {{ [sensorName: string]: [number, number][] }} sensorName: [timestamp, value][] */
        this.store = this.sensors.reduce((acc, cur) => {
            acc[cur] = [];
            return acc;
        }, {})
    }

    /**
     * addDatapoint
     * @param {string} sensorName 
     * @param {number} value 
     * @param {number | null} time use a predefined timestamp, or null if the timestamp should be generated
     */
    addDatapoint = (sensorName, value, time = null) => {
        if (typeof value !== 'number') throw new TypeError('Datapoint is not a number');
        if (!this.sensors.includes(sensorName)) throw new TypeError('Sensor is not valid');
        if (time === null) time = Date.now()

        this.lastAddTime = time
        this.store[sensorName].push([time, value]);

        this._updateStore()
    }

    /**
     * keeps the store from filling indefinitely
     * skips pruning if we are within a constant factor of target
     * @private
     */
    _updateStore() {
        if (this.windowModeMs) {
            if (this.lastPruneTime + (STORE_MAX_DATAPOINT_FACTOR * this.windowSize) > this.lastAddTime) {
                return;
            }
            
            this.lastPruneTime = this.lastAddTime
            for (const sensorName of this.sensors) {
                this.store[sensorName] = Predictor._sliceByTime(this.store[sensorName], this.lastAddTime - this.windowSize)
            }
        } else {
            for (const sensorName of this.sensors) {
                if (this.store[sensorName].length > this.windowSize * STORE_MAX_DATAPOINT_FACTOR * 2) {
                    this.store[sensorName] = this.store[sensorName].slice(-STORE_MAX_DATAPOINT_FACTOR * this.windowSize)
                }
            }
        }
    }

    predict = async () => {
        const samples = Predictor._merge(this.store, this.sensors);
        // const interpolated = Predictor._interpolate(samples, this.sensors.length) // interpolation is somehow broken?

        let window;
        if (this.windowModeMs) {
            window = Predictor._sliceByTime(samples, this.lastAddTime - this.windowSize)
        } else {
            window = samples.slice(-this.windowSize)
            if (window.length < this.windowSize) {
                throw new PredictorError("Not enough samples")
            }
        }

        const [featNames, feats] = await Predictor._extract(window, this.sensors.length, this.scaler)
        
        const pred = this.predictor(feats)
        return {
            prediction: this.labels[pred.reduce((iMax, x, i, arr) => x > arr[iMax] ? i : iMax, 0)],
            result: pred,
        }
    }

    /**
     * Keeps only entries created after certain time 
     * @param {((number | null)[])[]} samples [time, ...values][]
     * @param {number} keepSince Date timestamp, only entries with the same or later timestamps are kept in the result
     * @return {((number | null)[])[]}
     */
    static _sliceByTime(samples, keepSince) {
        return samples.filter(([time]) => time >= keepSince)
    }

    /**
     * @param {{ [sensorName: string]: [number, number][] }} store
     * @param {string[]} sensors
     * @return {((number | null)[])[]} ((number | null)[]): [time, ...values], values in the ordering of this.sensors, null for missing values
     */
    static _merge(store, sensors) {
        /** @type {{ [time: number]: { [sensorName: string]: number } }} */
        const out = {};
        for (const sensorName of sensors) {
            for (const [time, value] of store[sensorName]) {
                out[time] = out[time] || {};
                out[time][sensorName] = value
            }
        }
        return Object.entries(out).map(([time, values]) => {
            const arr = [time];
            for (const sensorName of sensors) {
                arr.push(values[sensorName] || null)
            }
            return arr;
        }).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    }

    /**
     * from pandas: ‘linear’: Ignore the index and treat the values as *equally* spaced.
     * @param {((number | null)[])[]} frame
     * @param {number} sensorsLength
     * @return {(number[])[]}
     */
    static _interpolate(frame, sensorsLength) {
        const lists = []
        for (let i = 0; i < sensorsLength; i++) {
            const sensorValues = frame.map(x => x[i+1]);
            interpolateLinear(sensorValues)
            lists[i] = sensorValues;
        }

        return frame.map(([time], i) => {
            const arr = [time];
            for (let j = 0; j < sensorsLength; j++) {
                arr.push(lists[j][i])
            }
            return arr;
        })
    }

    /**
     * 
     * @param {(number[])[]} frame 
     * @param {number} sensorsLength
     * @param {{ center: { [featureName: string]: number }, scale: { [featureName: string]: number } }} scaler
     * @returns {number[]}
     */
    static async _extract(frame, sensorsLength, scaler) {
        // cache these
        const felParams = await Predictor.felParams()
        const felFeaturesTSfresh = await Predictor.felFeaturesTSfresh()

        const feats = [] // [features, values]
        for (let i = 0; i < sensorsLength; i++) {
            const toF = frame.map(x => x[i+1]); // +1, because [0] is time in the frame
            const featureMap = await extractSome(felFeaturesTSfresh, toF, felParams)
            for (const [feat, val] of Object.entries(featureMap)) {
                feats.push([[i, feat], val])
            }
        }
        // sort features with the same sort as the server
        feats.sort(([[aI, aFeat]], [[bI, bFeat]]) => {
            if (aI !== bI) return aI - bI;
            return Predictor.featuresTSfresh.indexOf(aFeat) - Predictor.featuresTSfresh.indexOf(bFeat)
        })
        if (scaler) {
            for (let i = 0; i < feats.length; i++) {
                feats[i][1] = (feats[i][1] - scaler["center"][i]) / scaler["scale"][i]
            }
        }
        return [feats.map(x => x[0].join('__')), feats.map(x => x[1])]
    }
}

/** @type {string[]} features */
Predictor.featuresTSfresh = [
    "sum",
    "median",
    "mean",
    "length",
    "std_dev",
    "var",
    "root_mean_square",
    "max",
    "abs_max",
    "min" 
]
Predictor.felParams = cache(() => objToMap({"mean_n_abs_max_n": 8, "change_quantile_lower": -0.1, "change_quantile_upper": 0.1, "change_quantile_aggr": 0, "range_count_lower": -1, "range_count_upper": 1, "count_above_x": 0, "count_below_x": 0, "quantile_q": 0.5, "autocorrelation_lag": 1}))
Predictor.felFeaturesTSfresh = cache(() => arrToVector(Predictor.featuresTSfresh, 'string'))