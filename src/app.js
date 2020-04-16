const fs = require('fs');
const express = require('express');
const app = express();
const Busboy = require('busboy');
const compression = require('compression');
const ffmpeg = require('fluent-ffmpeg');
const uniqueFilename = require('unique-filename');
const endpoints = require('./endpoints.js');

const logger = require('./logger.js')

fileSizeLimit = parseInt(process.env.FILE_SIZE_LIMIT_BYTES || "536870912") //536870912 = 512MB 
port = 3000;
timeout = 3600000;

// catch SIGINT and SIGTERM and exit
// Using a single function to handle multiple signals
function handle(signal) {
    logger.info(`Received ${signal}. Exiting...`);
    process.exit(1)
  }  
//SIGINT is typically CTRL-C
process.on('SIGINT', handle);
//SIGTERM is sent to terminate process, for example docker stop sends SIGTERM
process.on('SIGTERM', handle);

app.use(compression());

for (let prop in endpoints.types) {
    if (endpoints.types.hasOwnProperty(prop)) {
        let ffmpegParams = endpoints.types[prop];
        let bytes = 0;
        app.post('/' + prop, function(req, res) {
            let hitLimit = false;
            let fileName = '';
            let savedFile = uniqueFilename('/tmp/');
            let busboy = new Busboy({
                headers: req.headers,
                limits: {
                    files: 1,
                    fileSize: fileSizeLimit,
            }});
            busboy.on('filesLimit', function() {
                logger.error(`upload file size limit hit. max file size ${fileSizeLimit} bytes.`)
            });

            busboy.on('file', function(
                fieldname,
                file,
                filename,
                encoding,
                mimetype
            ) {
                file.on('limit', function(file) {
                    hitLimit = true;
                    let msg = `${filename} exceeds max size limit. max file size ${fileSizeLimit} bytes.`
                    logger.error(msg);
                    res.writeHead(500, {'Connection': 'close'});
                    res.end(JSON.stringify({error: msg}));
                });
                let log = {
                    file: filename,
                    encoding: encoding,
                    mimetype: mimetype,
                };
                logger.debug(`file:${log.file}, encoding: ${log.encoding}, mimetype: ${log.mimetype}`);
                file.on('data', function(data) {
                    bytes += data.length;
                });
                file.on('end', function(data) {
                    log.bytes = bytes;
                    logger.debug(`file: ${log.file}, encoding: ${log.encoding}, mimetype: ${log.mimetype}, bytes: ${log.bytes}`);
                });

                fileName = filename;
                logger.debug(`uploading ${fileName}`)
                let written = file.pipe(fs.createWriteStream(savedFile));
                if (written) {
                    logger.debug(`${fileName} saved, path: ${savedFile}`)
                }
            });
            busboy.on('finish', function() {
                if (hitLimit) {
                    fs.unlinkSync(savedFile);
                    return;
                }
                logger.debug(`upload complete. file: ${fileName}`)
                let outputFile = savedFile + '.' + ffmpegParams.extension;
                logger.debug(`begin conversion from ${savedFile} to ${outputFile}`)
                
                //ffmpeg processing...
                let ffmpegConvertCommand = ffmpeg(savedFile);
                ffmpegConvertCommand
                        .renice(15)
                        .outputOptions(ffmpegParams.outputOptions)
                        .on('error', function(err) {
                            logger.error(`${err}`);
                            fs.unlinkSync(savedFile);
                            res.writeHead(500, {'Connection': 'close'});
                            res.end(JSON.stringify({error: `${err}`}));
                        })
                        .on('end', function() {
                            fs.unlinkSync(savedFile);
                            logger.debug(`starting download to client ${savedFile}`);

                            res.download(outputFile, null, function(err) {
                                if (err) {
                                    logger.error(`download ${err}`);
                                }
                                logger.debug(`deleting ${outputFile}`);
                                if (fs.unlinkSync(outputFile)) {
                                    logger.debug(`deleted ${outputFile}`);
                                }
                            });
                        })
                        .save(outputFile);
            });
            return req.pipe(busboy);
        });
    }
}

require('express-readme')(app, {
    filename: 'index.md',
    routes: ['/', '/readme'],
});


const server = app.listen(port, function() {
    let host = server.address().address;
    let port = server.address().port;
    logger.info('listening http://'+host+':'+port)
});

server.on('connection', function(socket) {
    logger.debug(`new connection, timeout: ${timeout}`);
    socket.setTimeout(timeout);
    socket.server.timeout = timeout;
    server.keepAliveTimeout = timeout;
});

app.use(function(req, res, next) {
  res.status(404).send(JSON.stringify({error: 'route not available'})+'\n');
});
