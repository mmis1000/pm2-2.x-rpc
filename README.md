# pm2-2.x-rpc

Dnode wrapper for `pm2` 2.x api

Usage:

```javascript
    var dnode = require('dnode');
    var Server = require('pm2-2.x-rpc').Server;
    
    var server = new Server();
    var client = dnode();
    
    // pipe the stream through any transport
    client.pipe(server).pipe(client);
    
    client.on('remote', function (pm2) {
        // got the pm2 instance
        // use whatever pm2 api method
        pm2.connect(function (err) {
            assert.ok(!err);
        })
    })
```