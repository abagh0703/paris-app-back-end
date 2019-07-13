const express = require('express');
const router = express.Router();
const { arrowModel } = require('../database');
const {debug} = require('../utils');


router.get('/', function(req, res) {
    // TODO find all where time is greater than now?
    arrowModel.find({}, (err, arrows) => {
        if (err) {
            debug(err);
            return [];
        }
        debug(arrows);
        return res.send(arrows);
    });
});


router.post('/', function(req, res) {
    const data = req.body;
    const arrow = new arrowModel({
        latitude: data.latitude,
        longitude: data.longitude,
        dateType: data.dateType,
        until: data.until,
        checkInTime: data.checkInTime,
    });
    arrow.save((err, newArrow) => {
        if (err) {
            debug(err);
            return res.status(500).send({errors: err.errors});
        }
        return res.send(newArrow);
    });
});




module.exports = router;
