/**
 *
 * @param {number} x 
 * @param {number} y 
 * @param {number} a 
 * @returns {number}
 */
 export const lerp = (x, y, a) => x * (1 - a) + y * a;
 /**
  * in place
  * @param {(number | null)[]} arr
  * @param {number | undefined} l value for entries before first known, if undefined first known
  * @param {number | undefined} r value for entries after last known, if undefined last known
  * @return {number[]} 
  */
 export const interpolateLinear = (arr, l, r) => {
     let leftmost = l;
     let nullCount = 0;
 
     for (let i = 0; i < arr.length;) {
         if (arr[i] !== null) {
             for (let j = 0; j < nullCount; j++) {
                 arr[i - (nullCount - j)] = typeof leftmost !== 'undefined' ? lerp(leftmost, arr[i], (j + 1) / (nullCount + 1)) : arr[i]
             }
             nullCount = 0;
 
             leftmost = arr[i];
             i++;
             continue;
         }
         for (; arr[i] === null; i++) {
             nullCount++
         }
     }
     for (let j = 0; j < nullCount; j++) {
         arr[arr.length - (nullCount - j)] = leftmost
     }
 }