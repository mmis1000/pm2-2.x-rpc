var dnode = require("dnode");
var parseArgs = require('dnode/lib/parse_args');
var pm2 = require("pm2");
var stream = require('stream');
var util = require("util");
var assert = require("assert");
var net = require("net");

/**
 * @type {Array.<string>}
 */
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

/**
 * @typedef methodOverrideObject
 * @type {object}
 * @property {Function} disconnect
 * @property {Function} launchBus
 */
 
/** @type {methodOverrideObject} */
var methodOverride = {
    'disconnect': function (cb) {
        /*
         * For some unknown reason, call cb in sync result in 
         * a unpredictable behavior. So we call it async.
         */
        try {
            pm2.disconnect();
        } catch (err) {
            if (cb) {
                return setTimeout(cb.bind(err), 0)
            } else {
                throw err;
            }
        }
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
            
            cloned.off = function (name) {
                bus.on.apply(bus, arguments);
                delete listeners[name];
            }
            
            this._dnode.on('end', function () {
                /* 
                 * after dnode instance destroyed
                 * remove every listener from bus and 
                 * close the bus connection to prevent from memory leak
                 */
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

/**
 * @returns {String}
 */
function randomId() {
    var s = '';
    for (var i = 0; i < 4; i++) {
        s += Math.random().toString(16).slice(2);
    }
    return s;
}

/**
 * @constructor
 * @description a dnode wrapper for pm2 api
 * @param {Object?} conf config object
 * @param {boolean?} conf.autoInit will dnode wrapper auto construct
 * @param {Object?} conf.socketOptions options that use as Duplex stream option
 */
function Server(conf) {
    /**
     * @type {{autoInit: boolean, socketOptions: Object}}
     */
    conf = conf || {};
    this.config = Object.assign({
        autoInit: true,
        socketOptions: {}
    }, conf);
    
    this.destroyed = false;
    this.dnode = null;
    this.methods = null;
    
    stream.Duplex.call(this, this.config.socketOptions);
    
    if (this.config.autoInit) {
        this.init();
    }
}

util.inherits(Server, stream.Duplex);

Server.prototype._write = function _write(chunk, encoding, callback) {
    assert.ok(!this.destroyed);
    assert.ok(this.dnode !== null);
    this.dnode.write(chunk);
    callback();
}

Server.prototype._read = function _read(size) {
    assert.ok(!this.destroyed);
    assert.ok(this.dnode !== null);
    // this.dnode.read(size);
}

/**
 * @description init uderlying dnode instance
 */
Server.prototype.init = function init() {
    this.methods = /** @type {Object.<string, Function>} */ pm2Methods
    .map(function (key) {
        // mirror methods only
        if ('function' !== typeof pm2[key]) {
            return;
        }
        
        return [key, pm2[key].bind(pm2)];
    })
    .filter(function (pair) {
        return !!pair;
    })
    .reduce(function (prev, curr) {
        prev[curr[0]] = curr[1];
        return prev;
    }, {});
    
    // copy the methods that should be override
    for (var key in methodOverride) {
        this.methods[key] = methodOverride[key].bind(this.methods);
    }
    
    // getter to allow override methods to access dnode instance
    Object.defineProperty(this.methods, '_dnode', {
        get: function () {
            return this.dnode;
        }.bind(this)
    })
    
    /** setup dnode */
    this.dnode = dnode(this.methods);
    
    /** forward end() method */
    this.on('finish', function () {
        this.dnode.end();
    })
    
    /** forward data from dnode to wrapper */
    this.dnode.on('data', function (data) {
        this.push(data);
    }.bind(this))
    
    /** forward end event from dnode */
    this.dnode.on('end', function () {
        // console.log('server end')
        this.push(null);
        // this instance of wrapper is invalidated after dnode instance ended
        this.dnode = null;
        this.methods = null;
        this.destroyed = true;
    }.bind(this))
    
    /** forward error event from dnode */
    this.dnode.on('error', this.emit.bind(this, 'error'))
    
    /** forward remote event from dnode to wrapper */
    this.dnode.on('remote', this.emit.bind(this, 'remote'))
    
    /** forward local event from dnode to wrapper */
    this.dnode.on('local', this.emit.bind(this, 'local'))
    
    /** forward fail event from dnode to wrapper */
    this.dnode.on('fail', this.emit.bind(this, 'fail'))
}

/**
 * @description ensure underlying connections got killed, actually alias of this.end()
 */
Server.prototype.destroy = function destroy() {
    this.end();
}


Server.prototype.connect = function () {
    var self = this;  
    var params = parseArgs(arguments);
    
    var stream;
    if (params.path) {
        stream = net.connect(params.path);
    }
    else if (params.port) {
        stream = net.connect(params.port, params.host);
    }
    else {
        throw new Error('no port or unix path given');
    }
    
    if (params.block) self.on('remote', params.block);
    
    stream.on('error', function (err) {
        if (err && err.code === 'EPIPE') return; // eat EPIPEs
        self.emit('error', err);
    });
    
    self.id = randomId();
    self.stream = stream;
    stream.pipe(self);
    self.pipe(stream);
    
    return self;
};

Server.prototype.listen = function listen(port) {
    assert('number' === typeof port);
    
    var conf = Object.assign({}, this.config, {autoInit: true});
    
    var params = parseArgs(arguments);

    var server = net.createServer(function (stream) {
        var d = new Server(conf);
        
        do { d.id = randomId() }
        while (server.sessions[d.id]);
        
        server.sessions[d.id] = d;
        
        d.on('end', function () {
            delete server.sessions[d.id];
        });
        
        d.on('local', function (ref) {
            server.emit('local', ref, d);
        });
        
        d.on('remote', function (remote) {
            server.emit('remote', remote, d);
        });
        
        stream.on('error', function (err) {
            if (err && err.code === 'EPIPE') return; // eat EPIPEs
            d.emit('error', err);
        });
        
        d.stream = stream;
        stream.pipe(d);
        d.pipe(stream);
    });
    
    
    server.sessions = {};
    
    if (typeof params.port === 'number' && params.port >= 0) {
        server.listen(params.port, params.host);
    }
    else if (params.path) {
        server.listen(params.path);
    }
    else {
        throw new Error('no port or path provided');
    }
    
    if (params.block) server.on('listening', params.block);
    
    return server;
}

module.exports = Server