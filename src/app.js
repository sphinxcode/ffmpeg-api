const express = require('express');
const app = express();
const compression = require('compression');
const all_routes = require('express-list-endpoints');

const logger = require('./utils/logger.js');
const constants = require('./constants.js');

fileSizeLimit = constants.fileSizeLimit;
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

//routes to handle file upload for all POST methods
var upload = require('./routes/uploadfile.js');
app.use(upload);

//test route for development
var test = require('./routes/test.js');
app.use('/test', test);

//routes to convert audio/video/image files to mp3/mp4/jpg
var convert = require('./routes/convert.js');
app.use('/convert', convert);

var extract = require('./routes/extract.js');
app.use('/video/extract', extract);


require('express-readme')(app, {
    filename: 'index.md',
    routes: ['/'],
});


const server = app.listen(constants.serverPort, function() {
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

app.get('/endpoints', function(req, res) {
    let code = 200;
    res.writeHead(code, {'content-type' : 'text/plain'});
    res.end("Endpoints:\n\n"+JSON.stringify(all_routes(app),null,2)+'\n');
});

app.use(function(req, res, next) {
  res.status(404).send({error: 'route not found'});
});


//custom error handler to return text/plain and message only
app.use(function(err, req, res, next){
    let code = err.statusCode || 500;
    let message = err.message;
    res.writeHead(code, {'content-type' : 'text/plain'});
    res.end(`${err.message}\n`);
    
});


logger.debug(JSON.stringify(all_routes(app)));
