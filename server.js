//
// Server code based primarily on node's TCP and Buffer libraries
//
var net = require('net');

// Read and log our configuration, adding console if specified
// Alternatively could offer command-line overrides, and also 
// do configuration via environment, e.g. production, testing, development
const config = require('./config.json');
const environment = process.env.NODE_ENV || 'development';

// Get timestamp for naming file
var now = new Date();

// Winston is our logger, write to file
// Always start off with log level info so that the basics are logged
var winston = require('winston');
var logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine( 
      winston.format.timestamp(),
      winston.format.splat(), 
      winston.format.simple(),
      winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
  ),
  transports: [
    new winston.transports.File({ filename: config.logDirectory + '/server.log.' + now.toISOString()}),
  ]
});

// Set up the console if asked for
const logging = config.logging[environment];
if ( logging.logConsole ) {
  logger.add(new winston.transports.Console());
}

// Log some basics
logger.info("Config file: " + JSON.stringify(config));
logger.info("Environment configured as " + environment);
logger.info("Setting log level to " + logging.logLevel);
logger.level = logging.logLevel;

// Our filo stack
var filo = [];

// Create application server, invoked on client connect
var server = net.createServer(function(client) {
    var clientInfo = client.address();
    logger.info('Client connected: ' + JSON.stringify(clientInfo));
    // This ensures we are reading binary data
    client.setEncoding(null);

    // Get current connections count.
    var count;
    server.getConnections(function (error, count) {
        if ( error ) {
            logger.error(JSON.stringify(err));
        } else {
            // Print current connection count in server console.
            logger.verbose('There are ' + count + ' connections now. ');
        }
    });

    // Send busy byte 0xFF if we are maxed out of connections
    if (count >= config.maxConnections) {
        logger.warn("Too many connections ... returning busy byte");
        client.end(Buffer.alloc(1, 0xFF));
    }

    //client.setTimeout(1000);

    // Process data
    client.on('data', function (data) {
        // Print received client data and length.
	// Check if amount of data sent matches expected amount of data sent
        var bytesRead = client.bytesRead;
	var buffer = Buffer.from(data);
        logger.verbose('Received ' + bytesRead + ' bytes: [' + buffer.toString('hex', 0, bytesRead) + ']');

        // If msb is 1 then this is a pop, else a push
        if ( buffer[0] & 0x80 ) {
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
        } else {
            // This is a push
	    // If this is a push, get the length and push the rest of this onto the FILO
            var length = buffer[0] & 0x7F;
            filo.push(buffer.slice(1, length+1));
            logger.verbose('Pushed ' + length + ' byte payload onto FILO. ' +
                           'FILO now has ' + filo.length + ' elements');

            // handle reads broken up over writes
            if ((bytesRead-1) != length) {
                logger.warn("payload size mismatch - expected %d bytes, got %d bytes", length, bytesRead-1);
            }

            // Push sends 0x00 back to client
            client.end(Buffer.alloc(1, 0));
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

    logger.info('TCP server listen on address: ' + serverInfoJson);

    server.on('close', function () {
        logger.info('TCP server socket is closed.');
    });

    server.on('error', function (error) {
        logger.error('Server error: ' + JSON.stringify(error));
    });

}).on('error', function(error) {
        logger.error('Server listen error: ' + JSON.stringify(error));
});

