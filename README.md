# sphinx-server-nodejs
SPHINX NodeJS Server 2.0.0

## Authors
Christopher Price (crprice***REMOVED***)

## License
See LICENSE

## Requires
* Node.js v8.1.2 (Server)
* ArrangoDB v3.1.23 (Database)
* ws v3.0.0 (WebSocket): https://github.com/websockets/ws
* arangojs v5.6.1 (Database Client): https://github.com/arangodb/arangojs
* nodemailer v4.0.1 (Email Client): https://github.com/nodemailer/nodemailer
* mmdb-reader v1.1.0 (GeoIP Reader): https://github.com/gosquared/mmdb-reader
```bash
npm install ws
npm install arangojs
npm install nodemailer
npm install mmdb-reader
```

## Usage
```bash
node sphinx_server.js PORT SERVER_ROLE [SLAVE_COUNT]
``` 

SERVER_ROLE can be one of MASTER or SLAVE

SLAVE_COUNT is the number of slaves to generate for a SERVER_ROLE of MASTER

*Example: Start master running on port 50010 with 10 slaves running on port 50011-50020*
```bash
nodejs sphinx_server.js 50010 MASTER 10 
```
