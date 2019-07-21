require('dotenv').config();
const express = require('express');
const router = express.Router();
let { logger, getCheckInPassword, getTwilioSid, getTwilioToken } = require('../utils');
const accountSid = getTwilioSid();
const authToken = getTwilioToken();
const client = require('twilio')(accountSid, authToken);
const { arrowModel }= require('../database');
const minutesOfBuffer = 10;
const distanceCheckBufferMeters = 200;

router.get('/arrows', function(req, res) {
    arrowModel.find({}, (err, arrows) => {
        if (err) {
            logger.error(err);
            return [];
        }
        logger.debug(arrows.length);
        return res.send(arrows);
    });
});


// To be called by a service that pings this endpoint every minute. I could use
// a cron job, but this was simpler.
// USED TO BE /arrows/check
router.get('/', (req, res) => {
    arrowModel.find({}, (err, arrows) => {
        if (err) {
            logger.error(err);
            return [];
        }
        arrows.forEach(handleArrowCheck);
        return res.send('Done checking!');
    });
});

function handleArrowCheck(arrow) {
    if (isLate(arrow.checkInTime)){
        logger.debug('is late');
        executePenalty();
        if (arrowIsInPast(arrow.until)){
            deleteArrow(arrow._id);
            return;
        }
        if (arrow.dateType === 'once'){
            deleteArrow(arrow._id);
        }
        else if (arrow.dateType === 'daily' || arrow.dateType === 'weekly'){
            logger.debug('is late and is type ' + arrow.dateType);
            updateArrowTime(arrow);
        }
    }
    else if (arrowIsInPast(arrow.until)){
        deleteArrow(arrow._id);
    }
}

function deleteArrow(arrowId) {
    arrowModel.findByIdAndDelete(arrowId, {}, () => {
        logger.debug('deleted arrow of id ' + arrowId);
    });
}

function arrowIsInPast(timeToCheck) {
    const timeNow = (new Date()).getTime();
    return timeNow - timeToCheck > 0;
}

function updateArrowTime(arrow){
    if (arrow.dateType === 'once') {
        deleteArrow(arrow._id);
    }
    else if (arrow.dateType === 'daily') {
        arrow.checkInTime = addDays(arrow.checkInTime, 1);
    }
    else if (arrow.dateType === 'weekly') {
        arrow.checkInTime = addDays(arrow.checkInTime, 7);
    }
    arrow.save((err) => {
        if (err) {
            logger.error('Error saving arrow');
            logger.error(err);
        }
    });
}

function addDays(timeInMs, numDays){
    const numDaysInMs = numDays * 24 * 60 * 60 * 1000;
    return timeInMs + numDaysInMs;
}

// in the future, alter this so it mass verifies emails and charges you $20
// that way
function executePenalty(){
    logger.warn('executing penalty');
    // const phoneNums = [process.env.OWNERPHONE, process.env.PERSON1PHONE, process.env.PERSON2PHONE];
    // TODO remove comment aboove and delete below when ready for production!
    const phoneNums = [process.env.OWNERPHONE];
    phoneNums.forEach((phoneNum) => {
        client.messages
        .create({
            body: process.env.TEXTMESSAGE,
            from: process.env.TWILIOPHONE,
            to: phoneNum,
        })
        .then(message => {logger.debug(message)})
        .done();
    });
}

function isOnTime(checkInTime){
    const minutesSinceCheckInTime = getMinutesSinceCheckInTime(checkInTime);
    return minutesSinceCheckInTime < minutesOfBuffer &&
        minutesSinceCheckInTime > -minutesOfBuffer;
}

function isLate(checkInTime) {
    const minutesSinceCheckInTime = getMinutesSinceCheckInTime(checkInTime);
    return minutesSinceCheckInTime > minutesOfBuffer;
}

function getMinutesSinceCheckInTime(checkInTime) {
    const timeNow = (new Date()).getTime();
    return convertMsToMinutes(timeNow - checkInTime);
}

function convertMsToMinutes(msTime){
    return (msTime/1000)/60;
}

router.post('/arrows', (req, res) => {
    const data = req.body;
    if (data.until && timestampIsNotInMs(data.until)) {
        logger.warn(data.until + ' ("until" value) is not in ms');
        return res.status(422).send(data.until + ' ("until" value) is not in ms');
    }
    else if (timestampIsNotInMs(data.checkInTime)){
        logger.warn(data.checkInTime + ' ("checkInTime" value) is not in ms');
        return res.status(422).send(data.checkInTime + ' ("checkInTime" value) is not in ms');
    }
    const arrow = new arrowModel({
        latitude: data.latitude,
        longitude: data.longitude,
        dateType: data.dateType,
        until: data.until,
        checkInTime: data.checkInTime,
        label: data.label,
        arrowType: data.arrowType,
    });
    arrow.save((err, newArrow) => {
        if (err) {
            logger.error('error creating new arrow');
            logger.error(err);
            return res.status(500).send({errors: err.message});
        }
        return res.send(newArrow);
    });
});

function timestampIsNotInMs(time) {
    return time.toString().length !== 13;
}

/**
 * Body: {latitude: 111, longitude: 111, checkInPassword: 'xxx'}
 */
router.delete('/arrows/:arrowId', (req, res) => {
    const {arrowId} = req.params;
    const storedCheckInPassword = getCheckInPassword();
    if (req.body.checkInPassword !== storedCheckInPassword) {
        return res.send({accepted: false, reason:
                `${req.body.checkInPassword} is not the correct password`});
    }
    arrowModel.findById(arrowId, (err, arrow) => {
        if (err || !arrow){
            logger.error(err);
            return res.send({accepted: false, reason: `Arrow with id ${arrowId} could not be found.`});
        }
        if (!isOnTime(arrow.checkInTime)) {
            return res.send({accepted: false, reason: `Too early or late; your check-in time is at ${msTimeToEST(arrow.checkInTime)}`})
        }
        const userLat = req.body.latitude;
        const userLong = req.body.longitude;
        const arrowLat = arrow.latitude;
        const arrowLong = arrow.longitude;
        const shouldBeWithin = arrow.arrowType === 'beSomewhere';
        const shouldNotBeWithin = arrow.arrowType === 'leaveSomewhere';
        const isWithin = isWithinTarget(userLat, userLong, arrowLat, arrowLong);
        if ((isWithin && shouldBeWithin) || (!isWithin && shouldNotBeWithin)){
            updateArrowTime(arrow);
            return res.send({accepted: true, reason: 'Successfully checked in!'});
        }
        else {
            const metersFromTarget = getMetersFromTarget(userLat, userLong, arrowLat, arrowLong);
            return res.send({accepted: false, reason: `You are ${metersFromTarget} meters from your target!`})
        }
    });
});

function isWithinTarget(userLat, userLong, arrowLat, arrowLong){
    const metersFromTarget = getMetersFromTarget(userLat, userLong, arrowLat, arrowLong);
    if (metersFromTarget - distanceCheckBufferMeters > 0) {
        return false;
    }
    return true;
}

function getMetersFromTarget(userLat, userLong, arrowLat, arrowLong){
    const milesFromTarget = milesBetweenPoints(userLat, userLong,
        arrowLat, arrowLong);
    return 1609.344 * milesFromTarget;
}

function msTimeToEST(msTime){
    return new Date(msTime).toLocaleString("en-US", {timeZone: "America/New_York"})
}

//:::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
//:::                                                                         :::
//:::  This routine calculates the distance between two points (given the     :::
//:::  latitude/longitude of those points). It is being used to calculate     :::
//:::  the distance between two locations using GeoDataSource (TM) prodducts  :::
//:::                                                                         :::
//:::  Definitions:                                                           :::
//:::    South latitudes are negative, east longitudes are positive           :::
//:::                                                                         :::
//:::  Passed to function:                                                    :::
//:::    lat1, lon1 = Latitude and Longitude of point 1 (in decimal degrees)  :::
//:::    lat2, lon2 = Latitude and Longitude of point 2 (in decimal degrees)  :::
//:::    unit = the unit you desire for results                               :::
//:::           where: 'M' is statute miles (default)                         :::
//:::                  'K' is kilometers                                      :::
//:::                  'N' is nautical miles                                  :::
//:::                                                                         :::
//:::  Worldwide cities and other features databases with latitude longitude  :::
//:::  are available at https://www.geodatasource.com                         :::
//:::                                                                         :::
//:::  For enquiries, please contact sales@geodatasource.com                  :::
//:::                                                                         :::
//:::  Official Web site: https://www.geodatasource.com                       :::
//:::                                                                         :::
//:::               GeoDataSource.com (C) All Rights Reserved 2018            :::
//:::                                                                         :::
//:::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::

function milesBetweenPoints(lat1, lon1, lat2, lon2, unit) {
    if ((lat1 === lat2) && (lon1 === lon2)) {
        return 0;
    }
    else {
        const radlat1 = Math.PI * lat1/180;
        const radlat2 = Math.PI * lat2/180;
        const theta = lon1-lon2;
        const radtheta = Math.PI * theta/180;
        let dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
        if (dist > 1) {
            dist = 1;
        }
        dist = Math.acos(dist);
        dist = dist * 180/Math.PI;
        dist = dist * 60 * 1.1515;
        if (unit === "K") { dist = dist * 1.609344 }
        if (unit === "N") { dist = dist * 0.8684 }
        return dist;
    }
}

module.exports = router;
