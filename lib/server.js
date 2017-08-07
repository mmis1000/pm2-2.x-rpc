var dnode = require("dnode");
var pm2 = require("pm2");
var stream = require('stream');
var util = require("util");
var assert = require("assert");
var pm2Methods = [
    'connect',
    'start',
    'disconnect',
    'stop',
    'restart',
    'delete',
    'gracefulReload',
    'killDaemon',
    'describe',
    'list',
    'dump',
    'flush',
    'reloadLogs',
    'launchBus',
    'sendSignalToProcessName',
    'sendDataToProcessId',
    'startup'
];

var methodOverride = {
    'disconnect': function (cb) {
        // console.log('disconnect', arguments)
        try {
            pm2.disconnect();
        } catch (err) {
            if (cb) {
                return setTimeout(cb.bind(err), 0)
            } else {
                throw err;
            }
        }
        //cb(null)
        if (cb) {
            setTimeout(cb, 0)
        }
    },
    'launchBus': function (cb) {
        pm2.launchBus(function (err, bus) {
            if (err) {
                return cb(err);
            }
            
            var cloned = {};
            
            for (var key in bus) {
                if ('function' === typeof bus[key]) {
                    cloned[key] = bus[key].bind(bus);
                }
            }
            
            var listeners = {};
            
            cloned.on = function (name, cb) {
                bus.on.apply(bus, arguments);
                listeners[name] = listeners[name] || [];
                listeners[name].push(cb);
            }
            
            this._dnode.on('end', function () {
                // console.log('killing bus...')
                for (var type in listeners) {
                    listeners[type].forEach(function (listener) {
                        bus.off(type, listener)
                    })
                }
                listeners = {};
                bus.close();
            })
            
            cb(null, cloned);
        }.bind(this))
    }
}

function Server(conf) {
    conf = conf || {};
    
    this.config = Object.assign({
        autoInit: true,
        socketOptions: {}
    }, conf);
    this.dnode = null;
    this.methods = null;
    
    stream.Duplex.call(this, this.config.socketOptions);
    
    if (this.config.autoInit) {
        this.init();
    }
}

util.inherits(Server, stream.Duplex);

Server.prototype._write = function _write(chunk, encoding, callback) {
    assert.ok(this.dnode !== null);
    this.dnode.write(chunk);
    callback();
}

Server.prototype._read = function _read(size) {
    assert.ok(this.dnode !== null);
    // this.dnode.read(size);
}

Server.prototype.init = function init() {
    this.methods = /*Object.keys(pm2)*/pm2Methods
    .map(function (key) {        
        // console.log(key, !!methodOverride[key], !!pm2[key], typeof methodOverride[key], typeof pm2[key]);
        
        if ('function' !== typeof pm2[key]) {
            return;
        }
        
        // console.log(key)
        
        return [key, pm2[key].bind(pm2)];
    })
    .filter(function (pair) {
        return !!pair;
    })
    .reduce(function (prev, curr) {
        prev[curr[0]] = curr[1];
        return prev;
    }, {});
    
    
    for (var key in methodOverride) {
        this.methods[key] = methodOverride[key].bind(this.methods);
    }
    
    Object.defineProperty(this.methods, '_dnode', {
        get: function () {
            return this.dnode;
        }.bind(this)
    })
    
    // console.log(this.methods);
    
    this.on('finish', function () {
        this.dnode.end();
    })
    
    this.dnode = dnode(this.methods);
    
    this.dnode.on('data', function (data) {
        this.push(data);
    }.bind(this))
    
    this.dnode.on('end', function () {
        // console.log('server end')
        this.push(null);
    }.bind(this))
    
    this.dnode.on('error', this.emit.bind(this, 'error'))
    
    // this.dnode.pause();
}

Server.prototype.destroy = function destroy() {
    this.end();
}

module.exports = Server