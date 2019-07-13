const mongoose = require('mongoose');
const {debug} = require('./utils');

mongoose.plugin((schema) => {
    schema.options.usePushEach = true;
});
const mongoDB = process.env.MONGODB;
// Set up default mongoose connection
mongoose.connect(mongoDB, {
    useMongoClient: true,
});
// Get the default connection
const db = mongoose.connection;
// Bind connection to error event (to get notification of connection errors)
db.on('error', debug('MongoDB connection error:'));
db.once('open', () => {
    debug('connected to mongo');
});
const { Schema } = mongoose;

/**
 *
 * @until: unix timestamp of when this arrow ends. Will usually be midnight of
 * some day
 * @clearedDates: array of unix timestamps for whenever they check in. TODO
 * see if this is necessary...
 */
const arrowSchema = new Schema({
    timeCreated: {type: Number, required: false, default: (new Date().getTime())},
    latitude: {type: Number, required: true},
    longitude: {type: Number, required: true},
    dateType: {type: String, required: true, lowercase: true, trim: true,
    enum: ['once','daily', 'weekly']},
    until: {type: Number, required: false},
    checkInTime: {type: Number, required: true},
    clearedDates: {type: [Number], default: []}
});
const arrowModel = mongoose.model('Arrows', arrowSchema, 'Arrows');
module.exports.arrow = arrowModel;