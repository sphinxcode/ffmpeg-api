const fs = require('fs');
const logger = require('./logger.js')


function deleteFile (filepath) {
    fs.unlinkSync(filepath);
    logger.debug(`deleted ${filepath}`);
}

module.exports = {
    deleteFile
}