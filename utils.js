require('dotenv').config();

//logger.log, trace, debug, info, warn, error
const logger = require('tracer').colorConsole({level: 'log'});
module.exports.logger = logger;

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

function getCheckInPassword(){
    return process.env.CHECKINPASSWORD;
}
module.exports.getCheckInPassword = getCheckInPassword;

function getTwilioSid(){
    return process.env.TWILIOSID;
}
module.exports.getTwilioSid = getTwilioSid;

function getTwilioToken(){
    return process.env.TWILIOTOKEN;
}
module.exports.getTwilioToken = getTwilioToken;