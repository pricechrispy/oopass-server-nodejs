# sphinx-server-nodejs
SPHINX Server for Node.js

## Requires
* WebSocket (ws): https://github.com/websockets/ws
* ArangoDB (arangojs): https://github.com/arangodb/arangojs
```bash
npm install ws
npm install arangojs
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
