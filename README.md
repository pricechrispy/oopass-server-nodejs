# oopass-server-nodejs
OOPASS NodeJS Server 2.0.0

## Description
OOPASS NodeJS Server provides a server-side NodeJS implementation of the Oblivious Online PASSword management system utilizing the SPHINX protocol.

## Authors
Christopher Price (pricechrispy***REMOVED***, crprice***REMOVED***)

## License
![AGPL3](https://www.gnu.org/graphics/agplv3-with-text-162x68.png)

OOPASS NodeJS Server

Copyright (C) 2017-2019  Christopher Price (pricechrispy***REMOVED***, crprice***REMOVED***)

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>

See LICENSE.md

## Requires
* Node.js v8.1.2 (Server): https://github.com/nodejs/node
* ArangoDB v3.1.23 (Database): https://github.com/arangodb/arangodb
* ws v3.0.0 (WebSocket): https://github.com/websockets/ws
* arangojs v5.6.1 (Database Client): https://github.com/arangodb/arangojs
* nodemailer v4.0.1 (Email Client): https://github.com/nodemailer/nodemailer
* mmdb-reader v1.1.0 (GeoIP Reader): https://github.com/gosquared/mmdb-reader
* ecurve v1.0.6 (ECC Operations): https://github.com/cryptocoinjs/ecurve/

Also see package.json

## Usage
```bash
node server.js PORT SERVER_ROLE [SLAVE_COUNT]
``` 

SERVER_ROLE can be one of MASTER or SLAVE

SLAVE_COUNT is the number of slaves to generate for a SERVER_ROLE of MASTER

*Example: Start master running on port 50010 with 10 slaves running on port 50011-50020*
```bash
nodejs server.js 50010 MASTER 10 
```

The server requires:
* a certificate and key for use in TLS web socket communication
* a running instance of ArangoDB for various storage needs

See server.js for configurable options.
