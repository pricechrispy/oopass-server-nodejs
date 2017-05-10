
const net = require('net');

const listen_options = {
    host: '0.0.0.0',
    port: 50000,
    exclusive: true
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
    
    socket.on( 'close', handle_socket_close );
    socket.on( 'timeout', handle_socket_timeout );
    socket.on( 'error', handle_socket_error );
    socket.on( 'data', handle_socket_data );
    
    socket.write( 'hello!' );
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



let server = net.createServer( handle_server_connection );
server.on( 'close', handle_server_close );
server.on( 'error', handle_server_error );

server.listen( listen_options, handle_server_listen );

