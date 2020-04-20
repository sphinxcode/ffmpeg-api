var express = require('express')
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

var router = express.Router()
const logger = require('../utils/logger.js')


//routes for /video/extract
//extracts audio from video
//extracts images from vide
router.post('/audio', function (req, res,next) {

    res.locals.conversion="audio"
    res.locals.format="wav"
    return extract(req,res,next);
});

router.post('/images', function (req, res,next) {

    res.locals.conversion="images"
    res.locals.format="png"
    return extract(req,res,next);
});

// extract audio or images from video
function extract(req,res,next) {
    let msg="Not yet implemented.";
    logger.error(msg);
    let err = new Error(msg);
    err.statusCode = 500;
    next(err);

}

module.exports = router