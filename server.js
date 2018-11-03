//
// Implementing in node.js
// net is standard with node
// Install winston logging package with 'npm install winston'
//
var net = require('net');

// Winston is our logger, write to file
// Always start off with log level info so that the basics are logged
var winston = require('winston');
var logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [
    new winston.transports.File({ filename: 'posterity.log' }),
  ]
});

// read and log our configuration, adding console if specified
// Alternatively could offer command-line overrides, and also 
// do configuration via environment, e.g. production, testing, development
const config = require('./config.json');
const environment = process.env.NODE_ENV || 'development';
const logging = config.logging[environment];

if ( logging.logConsole ) {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}
logger.info("Dumping config file: " + JSON.stringify(config));
logger.info("Configured as {" + environment + "} ");
logger.info("Setting log level to " + logging.logLevel);
logger.level = logging.logLevel;

var filo = [];

// Create application server, invoked on client connect
var server = net.createServer(function(client) {
    var clientInfo = client.address();
    logger.info('TCP client connect on address : ' + JSON.stringify(clientInfo));
    client.setEncoding(null);

    //client.setTimeout(1000);

    // Process data
    client.on('data', function (data) {
        // Print received client data and length.
	// Check if amount of data sent matches expected amount of data sent
        var bytesRead = client.bytesRead;
	var buffer = Buffer.from(data);
        logger.verbose('Received ' + bytesRead + ' bytes: [' + buffer.toString('hex', 0, bytesRead) + ']');

        // If msb is 0 then this is a push, else a pop
        if ( !(buffer[0] & 0x80) ) {
            // This is a push
	    // If this is a push, get the length and push the rest of this onto the FILO
            var length = buffer[0] & 0x7F;
            filo.push(buffer.slice(1, length+1));
            logger.verbose('Pushed ' + length + ' byte payload onto FILO. ' +
                           'FILO now has ' + filo.length + ' elements');

            // Push sends 0x00 back to client
            client.end(Buffer.alloc(1, 0));
        } else {
            // This is a pop
            var payload = filo.pop();
            var length = payload.length;
            logger.verbose('Popped ' + length + ' byte payload from FILO. ' +
                           'FILO now has ' + filo.length + ' elements');

            // create a buffer of length buffer.length + 1
            var sendBuffer = Buffer.alloc(length+1, 0);
            // set header byte - msb is 0, length is payload length
            sendBuffer[0] = payload.length & 0x7F;
            // copy sendBuffer into payload starting at payload[1]
            payload.copy(sendBuffer, 1);

            logger.verbose('Sending response: [' + sendBuffer.toString('hex') + ']');
            client.end(sendBuffer);
        }

    });

    // When client send data complete.
    client.on('end', function () {
        var message = 'Client disconnected: ';

        // Get current connections count.
        server.getConnections(function (error, count) {
            if ( error ) {
                logger.error(message + JSON.stringify(err));
            } else {
                // Print current connection count in server console.
                logger.verbose(message + 'There are ' + count + ' connections now. ');
            }

        });
    });

    // When client timeout.
    client.on('timeout', function () {
        logger.info('Client request time out. ');
    })

    // When client error.
    client.on('error', function (error) {
        logger.error('Client error: ' + JSON.stringify(error));
    })
});

// Create a TCP server listening on specified port
server.listen(config.serverPort, function () {
    // Get server address info.
    var serverInfo = server.address();
    var serverInfoJson = JSON.stringify(serverInfo);

    logger.info('TCP server listen on address : ' + serverInfoJson);

    server.on('close', function () {
        logger.info('TCP server socket is closed.');
    });

    server.on('error', function (error) {
        logger.error('Server error: ' + JSON.stringify(error));
    });

});

