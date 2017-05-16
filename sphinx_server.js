
const https = require('https');
const fs = require('fs');

const ws = require('ws');


const tls_options = {
    key: fs.readFileSync('sphinx-test-key.pem'),
    cert: fs.readFileSync('sphinx-test-cert.pem')
};
const listen_options = {
    port: 50000
};



/* SOCKET LISTENERS */

let handle_socket_close = function() {
    let message = 'Socket closed!';
    
    console.log( message );
};

let handle_socket_timeout = function() {
    let message = 'Socket timed out!';
    
    console.log( message );
    
    this.end();
};

let handle_socket_error = function( error ) {
    this.end();
    
    throw error;
};

let handle_socket_data = function( data ) {
    let message = 'Data received: "' + data.toString() + '"';
    
    console.log( message );
};



/* SERVER LISTENERS */
let handle_server_connection = function( socket ) {
    let message = 'Client connected';
    
    console.log( message );
    
    //socket.on( 'close', handle_socket_close );
    //socket.on( 'timeout', handle_socket_timeout );
    //socket.on( 'error', handle_socket_error );
    socket.on( 'message', handle_socket_data );
    
    socket.send('__test__');
};

let handle_server_close = function( had_error ) {
    let message = 'Closing... had error: ' + had_error.toString();
    
    console.log( message );
};

let handle_server_error = function( error ) {
    server.close();
    
    throw error;
};

let handle_server_listen = function() {
    let message = 'Server listening on ' + listen_options.host.toString() + ':' + listen_options.port.toString();    
    
    console.log( message );
}


let handle_server_request = function( request, response ) {
    res.writeHead(500);
}


let httpsServer = https.createServer( tls_options, handle_server_request );

httpsServer.listen( listen_options.port );



let wss = new ws.Server({ server: httpsServer });

wss.on( 'connection', handle_server_connection );



