


// REQUIRE JS LIBS
const lib_ecc = require('./lib_ecc.js');
const crypto  = require('crypto');



// REQUIRE NECECESSARY MODULES
const http     = require('http');
const https    = require('https');
const ws       = require('ws');
const fs       = require('fs');
const arangojs = require('arangojs');


// SETUP SERVER OPTIONS
const script_name = 'sphinx_server.js';
const tls_options = {
    key:  fs.readFileSync('sphinx-test-key.pem'),
    cert: fs.readFileSync('sphinx-test-cert.pem')
};
const listen_options = {
    port:        50000,
    role:        'MASTER',
    slave_count: 1,
    slaves:      new Array(),
    slave_pool:  'EVEN'
};
const aes_options = {
    algorithm: 'aes-256-ctr',
    key:       '123456789abcdef03456789abcdef012',
    plaintext: '00000000000000000000000000000000' // 256bits
};
const database_options = {
    host:       '127.0.0.1',
    port:       '8529',
    name:       'sphinx',
    collection: 'users',
    username:   'sphinx',
    password:   'sphinx'
};



/* PROGRAM ARGUMENTS */
if ( process.argv.length >= 3 )
{
    let program_first_argument  = process.argv[2];
    let program_second_argument = process.argv[3];
    let program_third_argument  = process.argv[4];
    
    listen_options.port = parseInt( program_first_argument, 10 );
    
    if ( program_second_argument === 'MASTER' )
    {
        listen_options.slave_count = parseInt( program_third_argument, 10 );
    }
    else
    {
        listen_options.role = 'SLAVE';
    }
}
else
{
    console.log( 'Usage: node sphinx_server.js PORT SERVER_ROLE [SLAVE_COUNT]' );
    console.log( 'SERVER_ROLE can be one of MASTER or SLAVE' );
    console.log( 'SLAVE_COUNT is the number of slaves to generate for a SERVER_ROLE of MASTER' );
    
    process.exit(1);
}

console.log( 'Server configured as follows:' );
console.log( listen_options );

if ( listen_options.role === 'MASTER' )
{
    const { spawn } = require('child_process');
    
    console.log( 'SERVER CONFIGURED AS MASTER, SPAWNING SLAVES ' + listen_options.slave_count.toString() );
    
    for ( let i = 0; i < listen_options.slave_count; i++ )
    {
        let slave_number = i + 1;
        let slave_port   = ( listen_options.port + slave_number ).toString();
        
        console.log( 'Spawning slave ' + slave_number.toString() + ' on *:' + slave_port );
        
        let slave_options = [ script_name, slave_port, 'SLAVE' ];
        
        listen_options.slaves[ i ] = spawn( 'node', slave_options );
        
        //listen_options.slaves[ i ].stdout.on('data', (data) => {
        //    console.log(`SLAVE ${slave_number} => stdout: ${data}`);
        //});

        //listen_options.slaves[ i ].stderr.on('data', (data) => {
        //    console.log(`SLAVE ${slave_number} => stderr: ${data}`);
        //});

        listen_options.slaves[ i ].on('close', (code) => {
            console.log(`SLAVE ${slave_number} => child process exited with code ${code}`);
        });
    }
}



/* DATABASE */

let database_config = {
    url:          'http://' + database_options.host + ':' + database_options.port,
    databaseName: database_options.name
};

console.log( 'Attempting connection to database server' );
console.log( database_config );

const db = new arangojs.Database( database_config );
db.useBasicAuth( database_options.username, database_options.password );

const users = db.collection( database_options.collection );


// check if database is online and exit if inaccessible
console.log( 'Requesting database server status' );

let request_options = {
    hostname: database_options.host,
    port:     database_options.port,
    timeout:  3000
};

let handle_request = function( response ) {
    let message = 'Database server seems to be running';    
    
    console.log( message );
};

let handle_request_socket = function( socket ) {
    socket.setTimeout( request_options.timeout );
    
    socket.on( 'timeout', handle_request_socket_timeout );
};

let handle_request_socket_timeout = function() {
    let message = 'Socket timeout while contacting database server, aborting request';

    console.log( message );
    
    server_up_request.abort();
};

let handle_request_error = function( error ) {
    let message = 'Database server request failed: ' + error.message;
    
    console.log( message );
    
    console.log( 'Exiting' );
    process.exit(1);
};

const server_up_request = http.request( request_options, handle_request );

server_up_request.on('socket', handle_request_socket );
server_up_request.on('error', handle_request_error );

server_up_request.end();


let process_beta_response = async function( web_socket, user_hash, user_requested_offset, alpha_decoded ) {
    let user_aes_ctr_offset = 0;
    
    try {
        console.log( 'Attempting retreival of user_hash: ' + user_hash.toString() );
        
        const data = await users.document( user_hash );
        
        console.log( 'Received data for user_hash: ' + user_hash.toString() );
        console.log( data );
        
        user_aes_ctr_offset = data.ctr_offset;
        
        if ( user_aes_ctr_offset.toString() !== user_requested_offset )
        {
            console.log( 'DIFFERENT USER CTR OFFSET REQUESTED: ' + user_requested_offset );
            
            user_aes_ctr_offset = user_requested_offset;
            
            // update ctr record for user hash with requested value
            data.ctr_offset = user_aes_ctr_offset;
            
            update_ctr_record( data );
        }
    }
    catch ( err ) {
        console.log( 'Error retreiving record ' + user_hash.toString() + ': ' + err.errorNum.toString() );
        
        if ( err.errorNum === 1202 ) // 1202 === ERROR_ARANGO_DOCUMENT_NOT_FOUND
        {
            console.log( 'Document not found' );
            
            // store new ctr record for user hash
            let new_user_record = { _key: user_hash, ctr_offset: user_aes_ctr_offset };
            
            create_ctr_record( new_user_record );
        }
        else
        {
            console.log( err.stack );
        }
    }
    
    console.log( 'Using CTR offset: ' + user_aes_ctr_offset.toString() );
    
    const sha_256 = crypto.createHash('sha256').update( user_hash + user_aes_ctr_offset.toString() );
    let hash_ctr  = sha_256.digest().slice(0, 16); //buffer object, 16*8 = 128bit block size
    
    console.log( 'User hash with offset: ' + hash_ctr.toString('hex') );
    
    const aes_ctr_256 = crypto.createCipheriv( aes_options.algorithm, aes_options.key, hash_ctr );
    let encrypted     = aes_ctr_256.update( aes_options.plaintext, 'utf8', 'hex' );
    
    let oprf_key = encrypted; //reduce modulo q
    
    console.log( 'Calculated user OPRF key: ' + oprf_key );
    
    let beta_key = new lib_ecc.BigInteger( oprf_key, 16 );
    let beta     = lib_ecc.encodePoint( alpha_decoded.multiply( beta_key ) );
    
    console.log( 'Sending Beta' );
    console.log( beta );
    
    web_socket.send( beta );
};

let create_ctr_record = async function( data ) {
    try {
        console.log( 'Attempting save of ' + data._key + ': ' + data.ctr_offset );
        
        const response = await users.save( data );
        
        console.log( 'Received response for save of ' + data._key + ': ' + data.ctr_offset );
        console.log( response );
    }
    catch ( err ) {
        console.log( 'Error saving record ' + data._key + ': ' + err.errorNum.toString() );
        
        if ( err.errorNum === 1210 ) // 1210 === ERROR_ARANGO_UNIQUE_CONSTRAINT_VIOLATED
        {
            console.log( 'Document already exists with _key: ' + data._key );
        }
        else
        {
            console.log( err.stack );
        }
    }
};

let update_ctr_record = async function( data ) {
    try {
        console.log( 'Attempting update of ' + data._key + ': ' + data.ctr_offset );
        
        const response = await users.update( data._id, {ctr_offset: data.ctr_offset} );
        
        console.log( 'Received response for update of ' + data._key + ': ' + data.ctr_offset );
        console.log( response );
    }
    catch ( err ) {
        console.log( 'Error saving record ' + data._key + ': ' + err.errorNum.toString() );
        console.log( err.stack );
    }
};

/*
let get_ctr_records = async function() {
    try {
        const query  = arangojs.aql`
            FOR user IN ${users}
            RETURN user
        `;
        
        const cursor = await db.query( query );
        
        let result = null;
        
        do {
            result = await cursor.next();
            
            if ( typeof result != 'undefined' )
            {
                console.log( result );
            }
        } while ( typeof result != 'undefined' || result != null );
    }
    catch ( err ) {
        console.log( err.stack );
    }
};
*/



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
let handle_socket_ping = function( data ) {
    let message = 'Ping received: "' + data.toString() + '"';
    
    console.log( message );
};

// Handle received pong
let handle_socket_pong = function( data ) {
    let message = 'Pong received: "' + data.toString() + '"';
    
    console.log( message );
};

// Handle socket messages
let handle_socket_data = function( data ) {
    let message = 'Data received: "' + data.toString() + '"';
    
    console.log( message );
    
    let data_array = data.toString().split(',');
    
    if ( data_array.length === 4 )
    {
        if ( listen_options.role === 'MASTER' )
        {
            console.log( 'ROLE IS MASTER, DELEGATING REQUESTS TO SLAVES' );
            
            let slave_responses = new Array();
            
            let handle_slave_responses = function( web_socket )
            {
                console.log( '========================================' );
                console.log( 'Received all slave responses' );
                
                let response_count = {};
                
                // index slaves by their response
                for ( let i = 0; i < slave_responses.length; i++ )
                {
                    let slave_response = slave_responses[ i ];
                    
                    if ( !response_count.hasOwnProperty( slave_response ) )
                    {
                        response_count[ slave_response ] = 0;
                    }
                    
                    response_count[ slave_response ]++;
                }
                
                // trust response with largest slave commitment
                let trusted_response       = '';
                let trusted_response_count = 0;
                
                for ( var [ key, value ] of Object.entries( response_count ) ) {
                    //console.log( key + ' ' + value );
                    
                    if ( value > trusted_response_count )
                    {
                        trusted_response_count = value;
                        trusted_response       = key;
                    }
                }
                
                console.log( trusted_response_count.toString() + ' slaves responded with ' + trusted_response );
                
                console.log( 'Sending trusted Beta response back to client' );
                console.log( trusted_response );
                
                web_socket.send( trusted_response );
            };
            
            // Delegate requests to chosen slaves
            // Most responded value will be chosen to defend against bad nodes
            console.log( 'Current queue has pool: ' + listen_options.slave_pool );
            let current_slave_connections = 0;
            
            for ( let i = 0; i < listen_options.slaves.length; i++ )
            {
                let slave_number = i + 1;
                let slave_port   = ( listen_options.port + slave_number ).toString();
                
                let is_even_match = listen_options.slave_pool === 'EVEN' && slave_number % 2 === 0;
                let is_odd_match  = listen_options.slave_pool === 'ODD' && slave_number % 2 === 1;
                
                // Only send to the active slave pool
                if ( is_even_match || is_odd_match )
                {
                    console.log( 'Sending to slave ' + slave_number.toString() + ' on *:' + slave_port );
                    current_slave_connections++;
                    
                    let client_web_socket = this;
                    
                    let slave_connection = new ws( 'wss://127.0.0.1:' + slave_port, '', {rejectUnauthorized: false} );
                    
                    slave_connection.on( 'error', handle_socket_error );
                    
                    slave_connection.on( 'message', function( slave_data ) {
                        console.log( 'SLAVE ' + slave_number.toString() + ' data' );
                        console.log( slave_data );
                        
                        let slave_data_array = slave_data.toString().split(',');
                        
                        if ( slave_data_array.length === 2 )
                        {
                            slave_responses.push( slave_data );
                            
                            if ( slave_responses.length === current_slave_connections )
                            {
                                handle_slave_responses( client_web_socket );
                            }
                        }
                    });
                    
                    slave_connection.on('open', function() {
                        slave_connection.send( data );
                    });
                }
            }
            
            // Switch to other slave pool
            if ( listen_options.slave_pool === 'EVEN' )
            {
                listen_options.slave_pool = 'ODD'
            }
            else
            {
                listen_options.slave_pool = 'EVEN';
            }
        }
        else
        {
            let x                     = data_array[0];
            let y                     = data_array[1];
            let user_hash             = data_array[2];
            let user_requested_offset = data_array[3];
            
            console.log( 'RECEIVED X,Y CURVE POINTS (' + x + ', ' + y + ')' );
            console.log( 'RECEIVED USER HASH: ' + user_hash );
            console.log( 'RECEIVED REQUESTED OFFSET: ' + user_requested_offset );
            
            let alpha_decoded = lib_ecc.decodePoint( x, y );
            
            console.log( 'DECODED' );
            
            let is_hashed_pwd_point_member = lib_ecc.pointMember( alpha_decoded );
            
            if ( is_hashed_pwd_point_member )
            {
                console.log( 'Point is a member of curve' );
                
                process_beta_response( this, user_hash, user_requested_offset, alpha_decoded );
            }
            else
            {
                console.log( 'Point is NOT a member of curve' );
            }
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
let connection_threshold          = 10;
let connection_threshold_interval = 5000;
let connections_by_address        = {};

// Handle after server bound
let handle_server_listen = function() {
    let message = 'Secure WebSocket server listening on *:' + listen_options.port.toString();    
    
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
let handle_server_connection = function( socket, tls_request ) {
    let current_time        = Date.now();
    let current_time_string = new Date( current_time ).toUTCString();
    
    let client_address = tls_request.connection.remoteAddress;
    let client_port    = tls_request.connection.remotePort;
    
    let message        = '[' + current_time_string + '] Client connected ' + client_address + ':' + client_port;
    
    console.log( message );
    
    if ( !connections_by_address.hasOwnProperty( client_address ) )
    {
        connections_by_address[ client_address ] = new Array();
    }
    
    connections_by_address[ client_address ].push( current_time );
    
    let total_connections = connections_by_address[ client_address ].length;
    
    if ( total_connections == connection_threshold )
    {
        console.log( 'ADDRESS REACHED CONNECTION THRESHOLD (' + client_address + ')' );
        
        let connection_time_first = connections_by_address[ client_address ][ 0 ];
        let connection_time_last  = connections_by_address[ client_address ][ total_connections - 1 ];
        
        let connection_time_elapsed = connection_time_last - connection_time_first;
        console.log( 'Time elapsed between connections: ' + connection_time_elapsed + 'ms (' + client_address + ')' );
        
        // remove first (oldest) value
        connections_by_address[ client_address ].shift();
        
        // If address connects too often in threshold period, assume service abuse
        if ( connection_time_elapsed <= connection_threshold_interval )
        {
            console.log( 'SOCKET REACHED TOO MANY ATTEMPTS IN THRESHOLD, CLOSING SOCKET' + ' (' + client_address + ')' );
            
            socket.close();
            return;
        }
    }
    
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



