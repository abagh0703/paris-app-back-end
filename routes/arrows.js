require('dotenv').config();
const express = require('express');
const request = require('request');
const router = express.Router();
const moment = require('moment');
let { logger, getCheckInPassword, getTwilioSid, getTwilioToken } = require('../utils');
const accountSid = getTwilioSid();
const authToken = getTwilioToken();
const client = require('twilio')(accountSid, authToken);
const { arrowModel }= require('../database');
const MINUTES_OF_BUFFER = 0;
const CAN_CHECK_IN_MINS_BEFORE = 10;
const dontBeHomeBufferMeters = 250;
const beSomewhereBufferMeters = 250;
const IFTTTFormat = "MMM D, YYYY -- h:ma";

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
        return res.send('Done checking ' + arrows.length + ' arrow(s)');
    });
});

function handleArrowCheck(arrow) {
    if (isLate(arrow.checkInTime)){
        logger.debug('is late');
        executePenalty(arrow.penaltyType);
        if (arrowIsExpired(arrow.until)){
            deleteArrow(arrow._id);
            return;
        }
        if (arrow.dateType === 'once'){
            deleteArrow(arrow._id);
        }
        else {
            logger.debug('is late and is type ' + arrow.dateType);
            updateArrowTime(arrow);
        }
    }
    else if (arrowIsExpired(arrow.until)){
        deleteArrow(arrow._id);
    }
}

function deleteArrow(arrowId) {
    arrowModel.findByIdAndDelete(arrowId, {}, () => {
        logger.debug('deleted arrow of id ' + arrowId);
    });
}

function arrowIsExpired(timeToCheck) {
    const timeNow = (new Date()).getTime();
    return timeNow - timeToCheck > 0;
}

function updateArrowTime(arrow){
    const dayOfWeek = (new Date()).getDay();
    const Sunday = 0;
    const Thursday = 4;
    const Friday = 5;
    const Saturday = 6;
    if (arrow.dateType === 'once') {
        deleteArrow(arrow._id);
    }
    else if (arrow.dateType === 'daily') {
        arrow.checkInTime = addDays(arrow.checkInTime, 1);
    }
    else if (arrow.dateType === 'weekly') {
        arrow.checkInTime = addDays(arrow.checkInTime, 7);
    }
    else if (arrow.dateType === 'weekdays') {
        let daysToAdd = 0;
        if (dayOfWeek >= Sunday && dayOfWeek <= Thursday) {
            daysToAdd = 1;
        }
        else if (dayOfWeek === Friday){
            daysToAdd = 3;
        }
        // not sure how it could be Saturday because 3 days are added on Fri,
        // but keeping it here to be safe
        else if (dayOfWeek === Saturday) {
            daysToAdd = 2;
        }
        arrow.checkInTime = addDays(arrow.checkInTime, daysToAdd);
    }
    else if (arrow.dateType === 'weekends') {
        let daysToAdd = 0;
        if (dayOfWeek === Saturday) {
            daysToAdd = 1;
        }
        else {
            daysToAdd = getNumDaysUntilSaturday(dayOfWeek);
        }
        arrow.checkInTime = addDays(arrow.checkInTime, daysToAdd);
    }
    arrow.save((err) => {
        if (err) {
            logger.error('Error saving arrow');
            logger.error(err);
        }
    });
}

function getNumDaysUntilSaturday(currentDayNum) {
    return 6 - currentDayNum;
}

function addDays(timeInMs, numDays){
    const numDaysInMs = numDays * 24 * 60 * 60 * 1000;
    return timeInMs + numDaysInMs;
}

const PAYMENT_AMOUNT = parseInt(process.env.PAYMENTAMOUNT);

function executePenalty(penaltyType){
    logger.warn('executing penalty');
    if (!penaltyType){
        penaltyType = 'text';
    }
    if (penaltyType === 'text') {
        executeTextPenalty();
    }
    else if (penaltyType === 'payment') {
        executePaymentPenalty(PAYMENT_AMOUNT);
    }
}

function executeTextPenalty() {
    // const phoneNums = [process.env.OWNERPHONE, process.env.PERSON1PHONE, process.env.PERSON2PHONE];
    // TODO remove comment above and delete below when ready for production!
    const phoneNums = [process.env.OWNERPHONE, process.env.PERSON1PHONE];
    // const phoneNums = [process.env.OWNERPHONE];
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

// executePaymentPenalty(1);
function executePaymentPenalty(paymentAmount){
    request.post('https://www.beeminder.com/api/v1/charges.json', {
        json: {
            auth_token: process.env.BEEMINDER_AUTH_TOKEN,
            amount: paymentAmount,
            note: 'Payment for not being at the right location at the right time'
        }
    }, (error, res, body) => {
        if (error) {
            logger.error(error);
            return
        }
        logger.debug('Successfully charged!');
        logger.debug(`statusCode: ${res.statusCode}`);
        logger.debug(body);
      }
    );

    /** PAYPAL CODE
    const currentTimestamp = (new Date().getTime());
    const options = { method: 'POST',
        url: `${process.env.PAYPALURL}/v1/oauth2/token`,
        auth: {
            user: process.env.PAYPALCLIENTID,
            password: process.env.PAYPALSECRET
        },
        form: { grant_type: 'client_credentials' } };
    request(options, function (error, response, body) {
        if (error) {
            throw new Error(error);
        }
        const accessToken = body.access_token;
        let options2 = { method: 'POST',
            url: `${process.env.PAYPALURL}/v1/payments/payouts`,
            headers:
                {   Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json' },
            body:
                { sender_batch_header:
                        { sender_batch_id: currentTimestamp,
                            email_subject: 'You have a payout!',
                            email_message: 'You have received a payout! Thanks for being lucky!' },
                    items:
                        [ { recipient_type: 'EMAIL',
                            amount: { value: paymentAmount, currency: 'USD' },
                            note: 'Thanks for being lucky!',
                            sender_item_id: currentTimestamp,
                            receiver: 'lucky@gmail.com' } ] },
            json: true };

        request(options2, function (error, response, body) {
            if (error) throw new Error(error);
            logger.debug('payment successful');
            logger.debug(body);
        });


    });
     */
}

function isOnTime(checkInTime){
    const minutesSinceCheckInTime = getMinutesSinceCheckInTime(checkInTime);
    return minutesSinceCheckInTime < MINUTES_OF_BUFFER &&
        minutesSinceCheckInTime > -CAN_CHECK_IN_MINS_BEFORE;
}

function isLate(checkInTime) {
    const minutesSinceCheckInTime = getMinutesSinceCheckInTime(checkInTime);
    return minutesSinceCheckInTime > MINUTES_OF_BUFFER;
}

function getMinutesSinceCheckInTime(checkInTime) {
    const timeNow = (new Date()).getTime();
    return convertMsToMinutes(timeNow - checkInTime);
}

function convertMsToMinutes(msTime){
    return (msTime/1000)/60;
}

function convertMinutesToMs(minutesTime) {
    return minutesTime * 60 * 1000
}

// dateString is type string of format May 21, 2022 at 03:16PM
function timestampIsNotInIFTTTFormat(dateString) {
    return !moment(dateString, IFTTTFormat, false).isValid();
}

/** dateString is type string of format IFTTTFormat. e.g. May 21, 2022 at 03:16PM.
    The time zone used to parse the string is the time zone of the server.
    E.g. I assume the timestamp will always be in PST so I set my server's time zone to PST so it works.
 */
function convertDateStringToTimestamp(dateString) {
    let momentObj = moment(dateString, IFTTTFormat, false);
    // now convert moment to number of milliseconds
    return momentObj.valueOf();
}

/** Body parameters for the POST /arrows request:
 *         latitude (required): int,
 *         longitude (required): int
 *         dateType (required): string with one of these values: once, daily, weekly, weekdays, weekends,
 *         until (required): int. Represents timestamp in ms; after this time, the arrow will never be checked again,
 *         checkInTime (required): int or string. Represents timestamp in ms that the arrow will first be checked.
 *          Instead of ms timestamp, it can also be of this form: May 21, 2022 at 03:16PM. Useful for use with IFTTT.
 *         label (optional): string. Label for your own purposes when viewing your arrows in the db
 *         arrowType (optional): string with one of these values: leaveSomewhere, beSomewhere. Default is beSomewhere.
 *         distanceOverride (optional): int. Represents distance in meters that you should be from the lat/long when
 *          checking in
 *         delay (optional): int. If present, will delay the first checkInTime by this number of minutes.
 *         Useful for IFTTT integrations.
 */
router.post('/arrows', (req, res) => {
    const data = req.body;
    let checkInTime = data.checkInTime;
    if (data.until && timestampIsNotInMs(data.until)) {
        logger.warn(data.until + ' ("until" value) is not in ms');
        return res.status(422).send(data.until + ' ("until" value) is not in ms');
    }
    if (timestampIsNotInMs(checkInTime)){
        if (timestampIsNotInIFTTTFormat(checkInTime)) {
            logger.warn(checkInTime + ' ("checkInTime" value) is not in ms or format: ' + IFTTTFormat);
            return res.status(422).send(checkInTime + ' ("checkInTime" value) is not in format: ' + IFTTTFormat);
        }
        else {
            checkInTime = convertDateStringToTimestamp(checkInTime)
        }
    }
    if (data.delay && Number.isInteger(data.delay)) {
        checkInTime += convertMinutesToMs(data.delay)
    }

    const arrow = new arrowModel({
        latitude: data.latitude,
        longitude: data.longitude,
        dateType: data.dateType,
        until: data.until,
        checkInTime,
        label: data.label,
        arrowType: data.arrowType,
        distanceOverride: data.distanceOverride
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
    return isNaN(time) || time.toString().length !== 13;
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
        let isWithin = null;
        if (shouldBeWithin) {
            let distanceToUse;
            distanceToUse = arrow.distanceOverride ?
            arrow.distanceOverride :
            beSomewhereBufferMeters;
            isWithin = isWithinTarget(userLat, userLong, arrowLat, arrowLong, distanceToUse);
        }
        else if (shouldNotBeWithin) {
            let distanceToUse;
            distanceToUse = arrow.distanceOverride ?
            arrow.distanceOverride :
            dontBeHomeBufferMeters;
            isWithin = isWithinTarget(userLat, userLong, arrowLat, arrowLong, distanceToUse);
        }
        else {
          isWithin = true;
        }
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

function isWithinTarget(userLat, userLong, arrowLat, arrowLong, bufferMeters){
    const metersFromTarget = getMetersFromTarget(userLat, userLong, arrowLat, arrowLong);
    return metersFromTarget - bufferMeters <= 0;
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
