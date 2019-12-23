
/*
OOPASS NodeJS Server
Copyright (C) 2017-2019  Christopher Price (pricechrispy, crprice)

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>
*/

// See README.md

// REQUIRE CORE MODULES
const crypto      = require('crypto'); // for CRYPTOGRAPHIC OPERATIONS
const http        = require('http'); // for HTTP LISTENER
const https       = require('https'); // for TLS LAYER
const fs          = require('fs'); // for DISK I/O

// REQUIRE THIRD-PARTY MODULES
const ws          = require('ws'); // for WEBSOCKETS
const arangojs    = require('arangojs'); // for DATABASE
const nodemailer  = require('nodemailer'); // for EMAIL
const mmdb_reader = require('mmdb-reader'); // for GEOIP
const BigInteger  = require('bigi'); // for LARGE INTS
const ecurve      = require('ecurve'); // for ECC


// SETUP SERVER OPTIONS
const script_name = 'server.js';
const server_version = '2.0.1';
const protocol_version = '2.0.*';

const connection_threshold          = 10;
const connection_threshold_interval = 5000;
const connections_by_address        = {};

const listen_options = {
    port:        50000,
    role:        'MASTER',
    slave_count: 1,
    slaves:      new Array(),
    slave_pool:  'EVEN'
};

const tls_options = {
    key:  fs.readFileSync('oopass-test-key.pem'),
    cert: fs.readFileSync('oopass-test-cert.pem')
};

//const aes_options = {
//    algorithm: 'aes-256-ctr',
//    key:       '123456789abcdef03456789abcdef012',
//    plaintext: '00000000000000000000000000000000' // 256bits
//};
const hmac_options = {
    algorithm:  'sha256',
    key:        '123456789abcdef03456789abcdef012'
};

const ec_options = ecurve.getCurveByName('secp256k1');

const database_options = {
    version:    30503,
    host:       '127.0.0.1',
    port:       '8529',
    name:       'oopass',
    collection: 'users',
    username:   'oopass',
    password:   'oopass'
};

const mail_options = {
    host:     'smtp.gmail.com',
    port:     465,
    ssl:      true,
    username: 'EMAIL ADDRESS',
    password: 'EMAIL PASSWORD',
    from:     'OOPASS <EMAIL ADDRESS>',
    subject:  'OOPASS Account Login Notification',
    text:     `
This is a notice about recent use of your API-Key.

--------------------------------------------------------------------------------
    ___ip_use_list___
--------------------------------------------------------------------------------

If this activity is yours, please disregard this notice.

Thanks,
OOPASS TEAM
              `,
    html:     `
This is a notice about recent use of your <span style="font-weight: bold;">API-Key</span>.
<br>
<br>
<div style="padding: 8px 12px; background: #333333; color: #CCCCCC;">
    ___ip_use_list___
</div>
<br>
If this activity is yours, please disregard this notice.
<br>
<br>
Thanks,<br>
OOPASS TEAM
              `
};

const geoip_options = {
    city_database: '/usr/share/GeoIP/GeoLite2-City.mmdb'
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
    console.log( 'Usage: node server.js PORT SERVER_ROLE [SLAVE_COUNT]' );
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
    
    let handle_slave_exit = function( slave_number, code ) {
        let message = 'ERROR: Slave ' + slave_number.toString() + ' => child process exited with code ' + code.toString();
        
        console.log( message );
    };
    
    for ( let i = 0; i < listen_options.slave_count; i++ )
    {
        let slave_number = i + 1;
        let slave_port   = ( listen_options.port + slave_number ).toString();
        
        console.log( 'Spawning slave ' + slave_number.toString() + ' on *:' + slave_port );
        
        let slave_options = [ script_name, slave_port, 'SLAVE' ];
        
        listen_options.slaves[ i ] = spawn( 'node', slave_options );
        listen_options.slaves[ i ].on( 'close', ( code ) => { handle_slave_exit( slave_number, code ); } );
    }
}



/* GEOIP LOOKUP */

let get_address_location = function( address ) {
    let geoip_reader = new mmdb_reader( geoip_options.city_database );
    let geoip_lookup = geoip_reader.lookup( address );
    
    let result = {
        text: ''
    };

    if ( geoip_lookup )
    {
        if ( geoip_lookup.country && geoip_lookup.country.iso_code )
        {
            result.country = geoip_lookup.country.iso_code;
            result.text    = result.country;
        }
        else
        {
            result.text = 'Unknown Country';
        }
        
        if ( geoip_lookup.subdivisions )
        {
            result.subdivisions = new Array();
            
            for ( let i = 0; i < geoip_lookup.subdivisions.length; i++ )
            {
                let subdivision = geoip_lookup.subdivisions[ i ];
                
                result.subdivisions.push( subdivision );
                result.text = subdivision.iso_code + ', ' + result.text;
            }
        }

        if ( geoip_lookup.city && geoip_lookup.city.names && geoip_lookup.city.names.en )
        {
            result.city = geoip_lookup.city.names.en;
            result.text = result.city + ', ' + result.text;
        }
    }
    else
    {
        result.text = 'Unknown Location';
    }
    
    return result;
};



/* MAILER */

let mailer = nodemailer.createTransport({
    host:   mail_options.host,
    port:   mail_options.port,
    secure: mail_options.ssl,
    auth: {
        user: mail_options.username,
        pass: mail_options.password
    }
});

let handle_mailer_result = function( error, info ) {
    if ( error )
    {
        console.log( 'Error has occured!' );
        console.log( error );
    }
    else
    {
        console.log( 'Message was sent!' );
        console.log( info );
    }
};

let send_warning_email = async function( user_hash, current_time_string, client_address_ipv4, client_location ) {
    let find_string    = '___ip_use_list___';
    let replace_string = '[' + current_time_string + '] ' + client_address_ipv4 + ' logged in from ' + client_location.text;
    
    user_email = await get_email_record( user_hash );
    
    if ( user_email.length > 0 )
    {
        let warning_email = {
            to:      user_email,
            from:    mail_options.from,
            subject: mail_options.subject,
            text:    mail_options.text.replace( find_string, replace_string ),
            html:    mail_options.html.replace( find_string, replace_string )
        };
        
        console.log( 'MAIL DISABLED: WOULD SEND TO ' + user_email );
        
        //mailer.sendMail( warning_email, handle_mailer_result );
    }
};



/* DATABASE */

let database_config = {
    url:            'http://' + database_options.host + ':' + database_options.port,
    arangoVersion:  database_options.version
};

console.log( 'Attempting connection to database server' );
console.log( database_config );

const db = new arangojs.Database( database_config );
db.useDatabase( database_options.name );
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


// calculate beta from user data
//let process_beta_response = async function( web_socket, user_hash, user_requested_offset, alpha_point ) {
let process_beta_response = async function( web_socket, user_hash, alpha_point, user_requested_email ) {
    //let user_aes_ctr_offset = 0;
    let user_email = user_requested_email;
    
    try {
        console.log( 'Attempting retreival of user_hash: ' + user_hash.toString() );
        
        const data = await users.document( user_hash );
        
        console.log( 'Received data for user_hash: ' + user_hash.toString() );
        console.log( data );
        
        user_email = data.email;
        //user_aes_ctr_offset = data.ctr_offset;
        //
        //if ( user_aes_ctr_offset.toString() !== user_requested_offset )
        //{
        //    console.log( 'DIFFERENT USER CTR OFFSET REQUESTED: ' + user_requested_offset );
        //    
        //    user_aes_ctr_offset = user_requested_offset;
        //    
        //    // update ctr record for user hash with requested value
        //    data.ctr_offset = user_aes_ctr_offset;
        //    
        //    update_ctr_record( data );
        //}
    }
    catch ( err ) {
        console.log( 'Error retreiving record ' + user_hash.toString() + ': ' + err.errorNum.toString() );
        
        if ( err.errorNum === 1202 ) // 1202 === ERROR_ARANGO_DOCUMENT_NOT_FOUND
        {
            console.log( 'Document not found' );
            
            // store new ctr record for user hash
            let new_user_record = {
                _key:   user_hash,
                email:  user_email
                //ctr_offset: user_aes_ctr_offset
            };
            
            create_ctr_record( new_user_record );
        }
        else
        {
            console.log( err.stack );
        }
    }
    
    //console.log( 'Using CTR offset: ' + user_aes_ctr_offset.toString() );
    
    //const sha_256 = crypto.createHash('sha256').update( user_hash + user_aes_ctr_offset.toString() );
    //let hash_ctr  = sha_256.digest().slice(0, 16); //buffer object, 16*8 = 128bit block size
    //
    //console.log( 'User hash with offset: ' + hash_ctr.toString('hex') );
    //
    //const aes_ctr_256 = crypto.createCipheriv( aes_options.algorithm, aes_options.key, hash_ctr );
    //let encrypted     = aes_ctr_256.update( aes_options.plaintext, 'utf8', 'hex' );
    //
    //let oprf_key = encrypted;
    
    console.log( 'Using email: ' + user_email );
    
    // user email + user identifier
    let hashForOPRF = user_email + user_hash;
    
    const hmac_sha256 = crypto.createHmac( hmac_options.algorithm, hmac_options.key );
    hmac_sha256.update( hashForOPRF );
    
    let oprf_key = hmac_sha256.digest('hex');
    
    console.log( 'Calculated user OPRF key: ' + oprf_key );
    
    //reduce modulo q
    let beta_key = BigInteger.fromHex( oprf_key );
    let beta_point = alpha_point.multiply( beta_key );
      
    console.log( 'beta.affineX: ' );
    console.log( beta_point.affineX );
    console.log( 'beta.affineY: ' );
    console.log( beta_point.affineY );
            
    let beta_x = beta_point.affineX.toBuffer(32);
    let beta_y = beta_point.affineY.toBuffer(32);
    
    let beta = beta_x.toString('hex') + ',' + beta_y.toString('hex');
    
    console.log( 'Sending Beta' );
    console.log( beta );
    
    web_socket.send( beta );
};


// manage user data records
let create_ctr_record = async function( data ) {
    try {
        //console.log( 'Attempting save of ' + data._key + ': ' + data.ctr_offset );
        console.log( 'Attempting save of ' + data._key );
        
        const response = await users.save( data );
        
        //console.log( 'Received response for save of ' + data._key + ': ' + data.ctr_offset );
        console.log( 'Received response for save of ' + data._key );
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
        
        let record_data_update = {
            ctr_offset: data.ctr_offset
        };
        
        const response = await users.update( data._id, record_data_update );
        
        console.log( 'Received response for update of ' + data._key + ': ' + data.ctr_offset );
        console.log( response );
    }
    catch ( err ) {
        console.log( 'Error saving record ' + data._key + ': ' + err.errorNum.toString() );
        console.log( err.stack );
    }
};

let get_email_record = async function( user_hash ) {
    try {
        console.log( 'Attempting retreival of user_hash: ' + user_hash.toString() );
        
        const data = await users.document( user_hash );
        
        console.log( 'Received data for user_hash: ' + user_hash.toString() );
        console.log( data );
        
        let user_email = '';
        
        if ( data.email )
        {
            console.log( 'Email Found: ' + data.email );
            
            user_email = data.email;
        }
        else
        {
            console.log( 'No email found' );
        }
        
        return user_email;
    }
    catch ( err ) {
        console.log( 'Error retreiving user_hash ' + user_hash.toString() + ': ' + err.errorNum.toString() );
        
        console.log( err.stack );
    }
};

let create_email_record = async function( user_hash, user_email ) {
    try {
        console.log( 'Attempting retreival of user_hash: ' + user_hash.toString() );
        
        const data = await users.document( user_hash );
        
        console.log( 'Received data for user_hash: ' + user_hash.toString() );
        console.log( data );
        
        if ( data.email )
        {
            console.log( 'Email already exists: not updating hash record' );
        }
        else
        {
            console.log( 'Attempting update of ' + data._key + ': ' + user_email );
            
            let record_data_update = {
                email: user_email
            };
            
            const response = await users.update( data._id, record_data_update );
            
            console.log( 'Received response for update of ' + data._key + ': ' + user_email );
            console.log( response );
        }
    }
    catch ( err ) {
        console.log( 'Error creating email record ' + user_hash.toString() + ': ' + err.errorNum.toString() );
        
        console.log( err.stack );
    }
};

let location_threshold = 5;

let check_location_mismatch = async function( user_hash, current_time_string, client_address_ipv4, client_location ) {
    let message = 'Checking location usage of ' + user_hash + ' at ' + client_location.text;
    
    console.log( message );
    
    try {
        console.log( 'Attempting retreival of user_hash: ' + user_hash.toString() );
        
        const data = await users.document( user_hash );
        
        console.log( 'Received data for user_hash: ' + user_hash.toString() );
        console.log( data );
        
        if ( data.locations )
        {
            console.log( 'Previously used locations found:' );
            console.log( data.locations );
            
            let is_location_mismatch = true;
            
            for ( let i = 0; i < data.locations.length; i++ )
            {
                let old_location = data.locations[ i ];
                
                if ( client_location.text === old_location )
                {
                    is_location_mismatch = false;
                    
                    break;
                }
            }
            
            if ( data.locations.length === location_threshold )
            {
                if ( is_location_mismatch )
                {
                    console.log( 'Location seems invalid: sending warning email' );
                    
                    send_warning_email( user_hash, current_time_string, client_address_ipv4, client_location );
                }
                else
                {
                    console.log( 'Location seems valid' );
                }
            }
            else
            {
                // save new location if not already in our list
                if ( is_location_mismatch )
                {
                    console.log( 'Attempting update of ' + data._key + ': locations' );
                    
                    data.locations.push( client_location.text );
                    
                    let record_data_update = {
                        locations: data.locations
                    };
                    
                    const response = await users.update( data._id, record_data_update );
                    
                    console.log( 'Received response for update of ' + data._key + ': locations' );
                    console.log( response );
                }
                else
                {
                    console.log( 'Location already exists in locations' );
                }
            }
        }
        else
        {
            console.log( 'Attempting creation of ' + data._key + ': locations' );
            
            let record_data_update = {
                locations: new Array()
            };
            
            record_data_update.locations.push( client_location.text );
            
            const response = await users.update( data._id, record_data_update );
            
            console.log( 'Received response for creation of ' + data._key + ': locations' );
            console.log( response );
        }
    }
    catch ( err ) {
        console.log( 'Error checking location records ' + user_hash.toString() + ': ' + err.errorNum.toString() );
        
        console.log( err.stack );
    }
    
    return true;
};



/* WEBSOCKET CLASS LISTENERS */

let handle_slave_responses = function( client_web_socket, slave_responses ) {
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
    
    for ( let [ key, value ] of Object.entries( response_count ) )
    {
        if ( value > trusted_response_count )
        {
            trusted_response_count = value;
            trusted_response       = key;
        }
    }
    
    console.log( trusted_response_count.toString() + ' slaves responded with ' + trusted_response );
    
    console.log( 'Sending trusted Beta response back to client' );
    console.log( trusted_response );
    
    client_web_socket.send( trusted_response );
    
    return trusted_response;
};

let handle_slave_socket_data = function( client_web_socket, slave_responses, current_slave_connections, slave_number, slave_data, user_hash, user_requested_email ) {
    let message = 'Data received from slave ' + slave_number.toString() + ' => "' + slave_data.toString() + '"';
    
    console.log( message );
    
    let slave_data_array = slave_data.toString().split(',');
    
    // accept invalid (point not member of curve) or beta responses
    if ( slave_data === 'invalid' || slave_data_array.length === 2 )
    {
        slave_responses.push( slave_data );
        
        // if we have collected all responses, choose the majority response
        if ( slave_responses.length === current_slave_connections )
        {
            let trusted_response = handle_slave_responses( client_web_socket, slave_responses );
            
            // Create the hash -> email assocation first time a hash is used
            if ( trusted_response !== 'invalid' && user_requested_email.length > 0 )
            {
                create_email_record( user_hash, user_requested_email );
            }
        }
    }
    else
    {
        // ignore other messages
    }
};

let process_data_role = function( client_web_socket, data, data_array, current_time_string, client_address_ipv4, client_location ) {
    let x                     = data_array[0];
    let y                     = data_array[1];
    let user_hash             = data_array[2];
    //let user_requested_offset = data_array[3];
    let user_requested_email  = data_array[3];
    
    console.log( 'RECEIVED X,Y CURVE POINTS (' + x + ', ' + y + ')' );
    console.log( 'RECEIVED USER HASH: ' + user_hash );
    //console.log( 'RECEIVED REQUESTED OFFSET: ' + user_requested_offset );
    console.log( 'RECEIVED REQUESTED EMAIL: ' + user_requested_email );
    
    if ( listen_options.role === 'MASTER' )
    {
        // handle api-key specific restrictions
        
        // if we have determined location mismatch is above threshold
        // send a warning email asynchronously and still process request
        check_location_mismatch( user_hash, current_time_string, client_address_ipv4, client_location );
        
        
        // If passed restrictions, continue processing request
        console.log( 'ROLE IS MASTER, DELEGATING REQUESTS TO SLAVES' );
        
        // Delegate requests to chosen slaves
        // Most responded value will be chosen to defend against bad nodes
        console.log( 'Current queue has pool: ' + listen_options.slave_pool );
        
        let slave_responses = new Array();
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
                current_slave_connections++;
                
                console.log( 'Sending to slave ' + slave_number.toString() + ' on *:' + slave_port );
                
                let slave_connection_options = {
                    rejectUnauthorized: false // PREVENT TLS REJECTION OF SELF-SIGNED CERTIFICATE
                };
                
                let slave_connection = new ws( 'wss://localhost:' + slave_port, '', slave_connection_options );
                
                slave_connection.on( 'error', handle_socket_error );
                slave_connection.on( 'message', ( slave_data ) => { handle_slave_socket_data( client_web_socket, slave_responses, current_slave_connections, slave_number, slave_data, user_hash, user_requested_email ); } );
                slave_connection.on( 'open', () => { slave_connection.send( data ); } );
            }
            else
            {
                // not member of current slave pool
            }
        }
        
        
        // Switch to other slave pool for next send event
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
        // We are a slave: use master's alpha to generate the beta
        let alpha_x = BigInteger.fromHex( x );
        let alpha_y = BigInteger.fromHex( y );
        
        let alpha_point = ecurve.Point.fromAffine( ec_options, alpha_x, alpha_y );
        
        console.log( 'DECODED' );
        //console.log( alpha_x );
        //console.log( alpha_y );
        //console.log( alpha_point );
        
        let is_hashed_pwd_point_member = ec_options.isOnCurve( alpha_point );
        
        if ( is_hashed_pwd_point_member )
        {
            console.log( 'Point is a member of curve' );
            
            //process_beta_response( client_web_socket, user_hash, user_requested_offset, alpha_point );
            process_beta_response( client_web_socket, user_hash, alpha_point, user_requested_email );
        }
        else
        {
            console.log( 'Point is NOT a member of curve' );
            
            client_web_socket.send('invalid');
        }
    }
};

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
    let current_time         = Date.now();
    let current_time_string  = new Date( current_time ).toUTCString();
    
    let tls_socket_peer_data = this._sender._socket._peername;
    let client_address       = tls_socket_peer_data.address;
    let client_port          = tls_socket_peer_data.port;
    
    let client_address_parts = client_address.split(':');
    let client_address_ipv4  = client_address_parts.pop();
    
    let client_location      = get_address_location( client_address_ipv4 );
    
    let message = '[' + current_time_string + '] Data received from ' + client_address + ':' + client_port + ' (' + client_location.text + ') => "' + data.toString() + '"';
    
    console.log( message );
    
    let data_array = data.toString().split(',');

    if ( data_array.length === 4 )
    {
        process_data_role( this, data, data_array, current_time_string, client_address_ipv4, client_location );
    }
    else
    {
        // ignore other messages
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

let reached_connection_threshold = function( client_address, current_time ) {
    if ( !connections_by_address.hasOwnProperty( client_address ) )
    {
        connections_by_address[ client_address ] = new Array();
    }
    
    connections_by_address[ client_address ].push( current_time );
    
    let total_connections = connections_by_address[ client_address ].length;
    
    if ( total_connections === connection_threshold )
    {
        console.log( 'ADDRESS REACHED CONNECTION THRESHOLD (' + client_address + ')' );
        
        let connection_time_first   = connections_by_address[ client_address ][ 0 ];
        let connection_time_last    = connections_by_address[ client_address ][ total_connections - 1 ];
        let connection_time_elapsed = connection_time_last - connection_time_first;
        
        console.log( 'Time elapsed between connections: ' + connection_time_elapsed.toString() + 'ms (' + client_address + ')' );
        
        // remove first (oldest) value
        connections_by_address[ client_address ].shift();
        
        // If address connects too often in threshold period, assume service abuse
        return connection_time_elapsed <= connection_threshold_interval;
    }
    
    return false;
};

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
    
    let client_address      = tls_request.connection.remoteAddress;
    let client_port         = tls_request.connection.remotePort;
    
    let message = '[' + current_time_string + '] Client connected ' + client_address + ':' + client_port;
    
    console.log( message );
    
    if ( reached_connection_threshold( client_address, current_time ) )
    {
        console.log( 'SOCKET REACHED TOO MANY ATTEMPTS IN THRESHOLD, CLOSING SOCKET' + ' (' + client_address + ')' );
        
        socket.close();
        return;
    }
    else
    {
        socket.on( 'open', handle_socket_open );
        socket.on( 'headers', handle_socket_headers );
        socket.on( 'ping', handle_socket_ping );
        socket.on( 'pong', handle_socket_pong );
        socket.on( 'message', handle_socket_data );
        socket.on( 'close', handle_socket_close );
        socket.on( 'unexpected-response', handle_socket_unexpected );
        socket.on( 'error', handle_socket_error );
        
        socket.send('__protocol_' + protocol_version + '_connected__');
    }
};

// Handle server error
let handle_server_error = function( error ) {
    throw error;
};


/* HTTPS (TLS) SERVER LISTENERS */

// Handle normal https server requests (non-websocket)
let handle_https_server_request = function( request, response ) {
    //ignore
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



