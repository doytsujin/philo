'use strict';

//
// Server code made easy due to node's TCP and Buffer libraries
//
// Read and log our configuration, adding console if specified
// Alternatively could offer command-line overrides, and also 
// do configuration via environment, e.g. production, testing, development
//
const config = require('./config.json');
const environment = process.env.NODE_ENV || 'development';

// Get timestamp for naming file
var gTimestamp = new Date();

// Used to signal blocking functions it is time to go home
var gKillMe = false;

// Package to help manage unique ids for each client
const uuidv4 = require('uuid/v4');
const logFilename = config.logDirectory + '/server.log.' + gTimestamp.toISOString();

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
    new winston.transports.File({ filename: logFilename }),
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

//////////////////////////////////////////////
// Global variables
//////////////////////////////////////////////

// Our LIFO stack
var gLIFO = [];

// Our client list
var gClients = {};


//////////////////////////////////////////////
// Functions
//////////////////////////////////////////////

//
// \fn bool oldClientDeleted
// \brief Go through gClients object, find the oldest object, determine if it is older than allowed, and delete it
//

function disconnectOldClient() {
    var disconnected = false;

    // sort the objects oldest to newest timestamp, with oldest at index 0.
    // TODO - optimize
    var sorted = Object.keys(gClients).sort(function(a,b){return gClients[a].timestamp-gClients[b].timestamp})
    
    var earliestUUID = sorted[0];
    var earliestDate = gClients[earliestUUID].timestamp;
    var now = Date.now();
    var elapsedTimeSeconds = (now-earliestDate)/1000;
    logger.verbose('Elapsed time: %d ms - %d ms = %f s', now, earliestDate, elapsedTimeSeconds);

    if ( elapsedTimeSeconds > config.staleConnectionPeriodSeconds ) {
        logger.verbose(earliestUUID + ':: Disconnecting client.counter = ' + gClients[earliestUUID].counter);
        gClients[earliestUUID].client.end();
        disconnected = true;
    }

    return disconnected;
}


//////////////////////////////////////////////
// main
//////////////////////////////////////////////

//
// Count how many times we have launched a client.  Useful for debugging (for humans who prefer
// not to use UUIDs for everything)
//
var gCounter = 0;

// Create application server, invoked on client connect
var net = require('net');
var appServer = net.createServer(function(client) {
    var clientInfo = client.address();
    var myUUID = uuidv4();
    var now = Date.now();

    // Increment the absolute number of clients we have seen to date (easier for ocular parsing than UUID)
    gCounter++;

    // Initialize variables used to manage stack and state
    var state = 'start';
    var payloadBytesRead = 0;
    var payloadLength = 0;
    var payloadList = [];
    var exitLoop = false;

    // Configure client as necessary
    // - This ensures we are reading binary data
    client.setEncoding(null);
    // - Sets timeout to 1s
    //client.setTimeout(1000);
  
    // TODO 
    // Check and handle connections
    // Direct access to this object is deprecated but still supported as of node v10.13.0, going
    // to be lazy and use it.
    var connections = appServer.connections;

    var message = myUUID + ':: Client connected: ' + JSON.stringify(clientInfo);
    message += ' There are ' + appServer.connections + ' connections now. ';
    logger.verbose(message);

    if ( connections > config.maxConnections) {
        // Check if there are any old connections.  If yes, then delete it and make space.  Otherwise
        // return a busy byte
        if ( !disconnectOldClient() ) {
            logger.warn("Too many connections [%d >= %d] ... returning busy byte", 
                        connections, config.maxConnections);
            client.end(Buffer.alloc(1, 0xFF));
            state = "busy";
        }
    }

    // Add myself to the list of clients, then increment absolute counter
    if ( state == 'start' ) {
        gClients[myUUID] =  {
            "timestamp" : now,
            "client" : client,
            "counter" : gCounter
        };
        logger.verbose('gClients[' + myUUID + '] = {timestamp: ' + now + ', counter: ' + gCounter + '}');
    }

    // Process data
    client.on('data', function (data) {
        // Print received client data and length.
	// Check if amount of data sent matches expected amount of data sent

	var buffer = Buffer.from(data);
        logger.silly(myUUID + ':: Received ' + buffer.length + ' bytes: [' + buffer.toString('hex') + ']');

        // If msb is 1 then this is a pop, else a push
        if ( (state == 'start') && (buffer[0] & 0x80)) {
            state = 'pop';
            var checkStackEmptyIteration = 0;

            // Block on pop if gLIFO is empty.  Retry every millisecond.
            // Will block indefinitely until something is available
            function checkStackEmpty() {
                if ( gKillMe || exitLoop ) {  
                    // Server wants to die, let it
                } else if ( gLIFO.length ) {
                    // Something on the stack!! Send it...
                    var payload = gLIFO.pop();
                    var length = payload.length;
                    // payload appears to always be ASCII, useful for debugging
                    logger.verbose(myUUID + ':: Popped ' + length + ' byte payload [' + payload.toString() +
                                   '] from LIFO. ' + 'LIFO now has ' + gLIFO.length + ' elements');

                    // create a buffer of length buffer.length + 1
                    var sendBuffer = Buffer.alloc(length+1, 0);
                    // set header byte - msb is 0, length is payload length
                    sendBuffer[0] = payload.length & 0x7F;
                    // copy sendBuffer into payload starting at payload[1]
                    payload.copy(sendBuffer, 1);

                    logger.verbose(myUUID + ':: Sending response: [' + sendBuffer.toString('hex') + ']');
                    client.end(sendBuffer);
                } else {
                    if ( !(++checkStackEmptyIteration % 1000) ) {
                        logger.verbose(myUUID + ':: Stack is empty, waiting for client to push...' + 
                                       checkStackEmptyIteration);
                    }
                    setTimeout(checkStackEmpty, 1);
                }
            }
            // Actually do it
            checkStackEmpty();

        } else if (state == 'push') {
            // handle serialized pushes
            payloadList.push(buffer);
            payloadBytesRead += buffer.length;
            if (payloadBytesRead >= payloadLength) {
                state = 'done';
            }
        } else if (state == 'start') {
            // This is a push.  Only set it up the first time.
            state = 'push';

	    // If this is a push, get the length and push the rest of this onto the LIFO
            payloadLength = buffer[0] & 0x7F;
            payloadList.push(buffer.slice(1, payloadLength+1));
            // Header is 1 byte, so payloadBytesRead is one less than total bytes read
            payloadBytesRead = buffer.length-1;

            // Some pushes may be complete the first time
            // Deliberately going to ignore cases where there is extra data waiting ... 
            // Could happen if push and pop requests are truly serialized, but not
            // going to handle that
            if (payloadBytesRead >= payloadLength) {
                state = 'done';
            } else {
                logger.silly(myUUID + ':: payload serialized - got %d of %d bytes', 
                             payloadBytesRead, payloadLength);
            }
        } else if (state == 'busy') {
            // Going to ignore the data and let this die
        } else {
            logger.error(myUUID + ':: Unknown state on data: ' + state + 
                         '. Cowardly ignoring data but continuing.');
        }

        // This is where the push is actually sent, whether data was serialized or not
        // (or specifically, whether data was serialized in more than one packet)
        if (state == 'done') {
            // Merge our serialized data
            var combinedPayload = Buffer.concat(payloadList);
            var checkStackFullIteration = 0;

            // Block on push if gLIFO has more than maxStackSize elements.  Retry every millisecond.
            // Will block indefinitely until something is popped
            function checkStackFull() {
                if ( gKillMe || exitLoop ) {  
                    // Server wants to die, let it
                } else if ( gLIFO.length < config.maxStackSize ) {
                    gLIFO.push(combinedPayload);
                    logger.verbose(myUUID + ':: Pushed ' + combinedPayload.length + ' byte payload [' + 
                                   combinedPayload.toString()+ '] onto LIFO. ' +
                                   'LIFO now has ' + gLIFO.length + ' elements');
                    // Push sends 0x00 back to client when we are done
                    client.end(Buffer.alloc(1, 0));
                } else {
                    if ( !(++checkStackFullIteration % 1000) ) {
                        logger.verbose(myUUID + ':: Stack is full, waiting for client to pop...');
                    }
                    setTimeout(checkStackFull, 1);
                }
            }
            // Actually do it
            checkStackFull();
        }
    });

    // Client closing up
    client.on('end', function () {
        var message = myUUID + ':: Client disconnected. State was [' + state + ']. ';
        var connections = appServer.connections;
        message += ' There are ' + appServer.connections + ' connections now. ';
        logger.verbose(message);

        // signal any blocking functions to exit
        exitLoop = true;

        // remove myself from the list
        logger.verbose('Deleting gClients[' + myUUID + ']');
        delete gClients[myUUID];
    });

    // When client timeout.
    client.on('timeout', function () {
        logger.info('Client request time out. ');

        // signal any blocking functions to exit
        exitLoop = true;

        // remove myself from the list
        logger.verbose('Deleting gClients[' + myUUID + ']');
        delete gClients[myUUID];
    })

    // When client error.
    client.on('error', function (error) {
        logger.error(myUUID + ':: Client error: ' + JSON.stringify(error));

        // signal any blocking functions to exit
        exitLoop = true;

        // remove myself from the list
        logger.verbose('Deleting gClients[' + myUUID + ']');
        delete gClients[myUUID];
    })
});

// Create the app server listening on the specified port
appServer.listen(config.serverPort, function () {
    // Get server address info.
    var serverInfo = appServer.address();
    var serverInfoJson = JSON.stringify(serverInfo);

    logger.info('App server started: ' + serverInfoJson);

    appServer.on('close', function () {
        logger.info('App server closed.');
    });

    appServer.on('error', function (error) {
        logger.error('App server error: ' + JSON.stringify(error));
    });

}).on('error', function(error) {
        logger.error('App server listen error: ' + JSON.stringify(error));
});

// Create the diagnostic server listening on the specified port
var diagnosticServer = net.createServer(function(diagClient) {
    var diagnosticInformation = {
        "appServerConnections":appServer.connections,
        "LIFOStackSize":gLIFO.length
    }

    var diagnosticInformationJSON = JSON.stringify(diagnosticInformation);
    logger.verbose("Diagnostic server connections.  Sending data and closing connection. " + 
                   diagnosticInformationJSON);
    diagClient.end(diagnosticInformationJSON);

    // When client send data complete.
    diagClient.on('end', function () {
        logger.verbose('Diagnostic connection closed');
    });

    // When client error.
    diagClient.on('error', function (error) {
        logger.error('Diagnostic error: ' + JSON.stringify(error));
    })
});

// Create the app server listening on the specified port
diagnosticServer.listen(config.diagnosticPort, function () {
    // Get server address info.
    var serverInfo = diagnosticServer.address();
    var serverInfoJson = JSON.stringify(serverInfo);

    logger.info('Diagnostic server started: ' + serverInfoJson);

    diagnosticServer.on('close', function () {
        logger.info('Diagnostic server closed.');
    });

    diagnosticServer.on('error', function (error) {
        logger.error('Diagnostic server error: ' + JSON.stringify(error));
    });

}).on('error', function(error) {
        logger.error('Diagnostic server listen error: ' + JSON.stringify(error));
});

//
// Capture SIGINT and SIGKILL for a clean exit
//
function shutdown() {
    var diagnosticInformation = {
        "appServerConnections":appServer.connections,
        "LIFOStackSize":gLIFO.length
    }

    var diagnosticInformationJSON = JSON.stringify(diagnosticInformation);
    logger.verbose("Final tallies: " + diagnosticInformationJSON);

    // Signal running events to die, then signal servers to close
    gKillMe = true;
    appServer.close();
    diagnosticServer.close();

    // Extremely useful printout for lessing file during debug
    logger.verbose('Wrote ' + logFilename);
}

process.on('SIGTERM', function() {
    logger.warn('SIGTERM captured, shutting down...');
    shutdown();
});
process.on('SIGINT', function() {
    logger.warn('SIGINT captured, shutting down...');
    shutdown();
});
process.on('uncaughtException', function(error) {
    logger.error('UncaughtException::' + error.message + '::' + error.stack);
    logger.error('Shutting down...');
    shutdown();
});
