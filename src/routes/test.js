var express = require('express')


var router = express.Router()
const logger = require('../utils/logger.js')

//route to handle file upload in all POST requests


// convert audio or video or image to mp3 or mp4 or jpg
router.post("/",function (req, res,next) {
    logger.debug("path: " + req.path);
    logger.debug("req.params: ");
    for (const key in req.params) {
        logger.debug(`${key}: ${req.params[key]}`);
      }
    logger.debug("res.locals.savedFile: " + res.locals.savedFile);
    res.status(200).send("Test OK.");
          
});

module.exports = router;