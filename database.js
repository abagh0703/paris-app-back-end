require('dotenv').config();
const mongoose = require('mongoose');
let {logger} = require('./utils');


mongoose.plugin((schema) => {
    schema.options.usePushEach = true;
});
const mongoDB = process.env.MONGODB;
// Set up default mongoose connection
mongoose.connect(mongoDB, {useNewUrlParser: true});
// Get the default connection
const db = mongoose.connection;
// Bind connection to error event (to get notification of connection errors)
db.on('error', () => logger.debug('MongoDB connection error:'));
db.once('open', () => {
    logger.log('Connected to MongoDB')
});
const { Schema } = mongoose;

/**
 *
 * @until: ms timestamp of when this arrow ends. Will usually be midnight of
 * some day
 * @clearedDates: array of ms timestamps for whenever they check in. TODO
 * see if this is necessary...
 */
const arrowSchema = new Schema({
    timeCreated: {type: Number, required: false, default: (new Date().getTime())},
    latitude: {type: Number, required: true},
    longitude: {type: Number, required: true},
    dateType: {type: String, required: true, lowercase: true, trim: true,
    enum: ['once','daily', 'weekly', 'weekdays', 'weekends']},
    until: {type: Number, required: false, default: 9999999999999, min: 1000000000000, max: 9999999999999},
    checkInTime: {type: Number, required: true, min: 1000000000000, max: 9999999999999},
    clearedDates: {type: [Number], default: []},
    label: {type: String, default: 'Arrow', required: false},
    arrowType: {type: String, enum: ['beSomewhere', 'leaveSomewhere'], default: 'beSomewhere'},
    penaltyType: {type: String, default: 'payment', enum: ['text', 'payment']},
});
const arrowModel = mongoose.model('Arrows', arrowSchema, 'Arrows');
module.exports.arrowModel = arrowModel;