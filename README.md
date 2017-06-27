# sphinx-server-nodejs
SPHINX Server for Node.js

## Requires
* WebSocket v3.0.0 (ws): https://github.com/websockets/ws
* ArangoDB v5.6.1 (arangojs): https://github.com/arangodb/arangojs
* nodemailer v4.0.1: https://github.com/nodemailer/nodemailer
* mmdb-reader v1.1.0: https://github.com/gosquared/mmdb-reader
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
