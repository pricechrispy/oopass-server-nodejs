


// REQUIRE JS LIBS
const lib_ecc = require('./lib_ecc.js');



// REQUIRE NECECESSARY MODULES
const https = require('https');
const ws    = require('ws');
const fs    = require('fs');


// SETUP SERVER OPTIONS
const tls_options = {
    key:  fs.readFileSync('sphinx-test-key.pem'),
    cert: fs.readFileSync('sphinx-test-cert.pem')
};
const listen_options = {
    port: 50000
};
const ecc_options = {
    oprf_key: '123456789abcdef03456789abcdef012'
};



/* WEBSOCKET CLASS LISTENERS */

// Handle established connection
let handle_socket_open = function() {
    let message = 'Socket connection established';
    
    console.log( message );
};

// Read headers received
let handle_socket_headers = function( headers, response ) {
    let message = 'Headers received';
    
    console.log( message );
    console.log( headers );
};

// Handle received ping
let handle_socket_ping = function( data, flags ) {
    let message = 'Ping received: "' + data.toString() + '"';
    
    console.log( message );
    console.log( flags );
};

// Handle received pong
let handle_socket_pong = function( data, flags ) {
    let message = 'Pong received: "' + data.toString() + '"';
    
    console.log( message );
    console.log( flags );
};

// Handle socket messages
let handle_socket_data = function( data, flags ) {
    let message = 'Data received: "' + data.toString() + '"';
    
    console.log( message );
    console.log( flags );
    
    let data_array = data.toString().split(",");
    
    if ( data_array.length === 2 )
    {
        let x = data_array[0];
        let y = data_array[1];
        
        console.log( 'RECEIVED X,Y CURVE POINTS (' + x + ', ' + y + ')' );
        
        let alpha_decoded = lib_ecc.decodePoint( x, y );
        
        console.log( 'DECODED' );
        //console.log( decoded );
        
        var is_hashed_pwd_point_member = lib_ecc.pointMember( alpha_decoded );
        
        if ( is_hashed_pwd_point_member )
        {
            console.log( 'Point is a member of curve' );
            
            var beta_key = new lib_ecc.BigInteger( ecc_options.oprf_key, 16 );
            var beta = lib_ecc.encodePoint( alpha_decoded.multiply( beta_key ) );
            
            console.log( 'Sending Beta' );
            console.log( beta );
            
            this.send( beta );
        }
        else
        {
            console.log( 'Point is NOT a member of curve' );
        }
    }
};

// Handle when a socket connection closes
let handle_socket_close = function( code, reason ) {
    let message = 'Socket closed (' + code.toString() + '): "' + reason + '"';
    
    console.log( message );
};

// Handle unexpected response
let handle_socket_unexpected = function( request, response ) {
    let message = 'Unexpected response received';
    
    console.log( message );
    console.log( request );
    console.log( response );
};

// Handle underlying net.Socket (and above) errors
let handle_socket_error = function( error ) {
    let message = 'Socket error - terminating socket:';
    
    console.log( message );
    console.log( error );   
    
    this.terminate();
    
    throw error;
};



/* WEBSOCKET SERVER LISTENERS */

// Handle after server bound
let handle_server_listen = function() {
    let message = 'Server listening on *:' + listen_options.port.toString();    
    
    console.log( message );
};

// Handle server/client handshake
let handle_server_handshake = function( info ) {
    let message = 'Accepting handshake:';    
    
    console.log( message );
    //console.log( info );
    
    return true;
};

// Handle server/client protocol
let handle_server_protocol = function( protocols, request ) {
    let message = 'Accepting protocols:';    
    
    console.log( message );
    console.log( protocols );
    
    return '';
};

// Handle headers before handshake
let handle_server_headers = function( headers, request ) {
    let message = 'Sending headers...';
    
    console.log( message );
    console.log( headers );
};

// Handshake is complete: socket is an instance of WebSocket
let handle_server_connection = function( socket ) {
    let message = 'Client connected';
    
    console.log( message );
    
    socket.on( 'open', handle_socket_open );
    socket.on( 'headers', handle_socket_headers );
    socket.on( 'ping', handle_socket_ping );
    socket.on( 'pong', handle_socket_pong );
    socket.on( 'message', handle_socket_data );
    socket.on( 'close', handle_socket_close );
    socket.on( 'unexpected-response', handle_socket_unexpected );
    socket.on( 'error', handle_socket_error );
    
    socket.send('__server_connected__');
};

// Handle server error
let handle_server_error = function( error ) {
    
    
    throw error;
};


/* HTTPS (TLS) SERVER LISTENERS */

// Handle normal https server requests (non-websocket)
let handle_https_server_request = function( request, response ) {
    
};


// START THE BASE HTTPS (TLS) SERVER
let httpsServer = https.createServer( tls_options, handle_https_server_request );

httpsServer.listen( listen_options.port );


// START WEBSOCKET SERVER ON AN HTTPS SERVER
let websocket_server_options = {
    server: httpsServer,
    verifyClient: handle_server_handshake,
    handleProtocols: handle_server_protocol
};

let wss = new ws.Server( websocket_server_options );

wss.on( 'listening', handle_server_listen );
wss.on( 'headers', handle_server_headers );
wss.on( 'connection', handle_server_connection );
wss.on( 'error', handle_server_error );



