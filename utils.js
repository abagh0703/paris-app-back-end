const debug = require('debug');
module.exports.debug = debug;

function objectHasProperties(obj, keysArray) {
    if (!obj || !keysArray || !Array.isArray(keysArray) || typeof obj !==
        'object') {
        return false;
    }
    return (keysArray.every(function(x) {
        return x in obj;
    }));
}
module.exports.objectHasProperties = objectHasProperties;