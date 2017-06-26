


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
const tls_options = {
    key:  fs.readFileSync('sphinx-test-key.pem'),
    cert: fs.readFileSync('sphinx-test-cert.pem')
};
const listen_options = {
    port: 50000
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
        
        return response;
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
    
    if ( data_array.length === 4 )
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



