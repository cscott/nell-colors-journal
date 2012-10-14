var apejs = require("apejs.js");
var console = require("console.js");
var googlestore = require("googlestore.js");
var nell_version = require("version.js");
var mustache = require("./common/mustache.js");

var Text = com.google.appengine.api.datastore.Text;

var CORSHosts = [
    'http://nell-colors.github.cscott.net',
    'http://dev.laptop.org'
];

var BATCH_SIZE = 25; // items at a time.

var ajaxResponse = function(response, callback) {
    response.addHeader('Access-Control-Allow-Origin',
                       CORSHosts.join(' '));
    return {
        write: function(value) {
            var writer;
            if (callback) { // JSONp
                response.setContentType('text/javascript;charset=UTF-8');
                writer = response.getWriter();
                writer.print(callback);
                writer.print('(');
                writer.print(JSON.stringify(value));
                writer.print(')');
            } else { // regular JSON
                response.setContentType('application/json;charset=UTF-8');
                writer = response.getWriter();
                writer.print(JSON.stringify(value));
            }
        }
    };
};
var makeUserDbKey = function(uuid, dbname) {
    var userKey, dbKey;
    if (uuid==='*') {
        dbKey = googlestore.createKey("Database", dbname);
    } else {
        userKey = googlestore.createKey("User", uuid);
        dbKey = googlestore.createKey(userKey, "Database", dbname);
    }
    return dbKey;
};
var makeUserDbItemKey = function(uuid, dbname, key) {
    var dbKey = makeUserDbKey(uuid, dbname);
    var itemKey = googlestore.createKey(dbKey, "Item", key);
    return itemKey;
};

apejs.urls = {
    "/version": {
        // return version of this nell-colors-journal code
        get: function(request, response, matches) {
            var p = param(request);
            var callback = p("callback"); // JSONP (optional)
            ajaxResponse(response, callback).write(nell_version);
        }
    },
    /* don't necessarily need to know the user id in order to GET */
    "/(get|exists)/([a-zA-Z0-9_-]+|[*])": {
        get: function(request, response, matches) {
            var getOrExists = matches[1];
            var uuid = matches[2];
            var p = param(request);
            var dbname = p("dbname");
            var key = p("key");
            var callback = p("callback"); // JSONP (optional)

            // fetch result
            var itemKey = makeUserDbItemKey(uuid, dbname, key);
            var item=null, found=false;
            try {
                item = googlestore.get(itemKey);
                found = true;
            } catch (e if e.javaException instanceof
                     googlestore.EntityNotFoundException) {
                found = false;
            }
            var result;
            if (getOrExists==='get') {
                result = item ? {
                    // note we must convert Java string to JavaScript strings
                    // for key, version, and value (via Text.getValue())
                    key: ''+key,
                    value: ''+item.getProperty('value').getValue(),
                    version: ''+item.getProperty('version')
                } : null;
            } else { // exists
                result = found;
            }
            ajaxResponse(response, callback).write(result);
        }
    },
    /* require UUID in order to modify or delete an item */
    "/(put|delete)/([a-zA-Z0-9_-]+)": {
        post: function(request, response, matches) {
            var putOrDelete = matches[1];
            var uuid = matches[2];
            var p = param(request);
            var dbname = p("dbname");
            var key = p("key");
            var value = p("value"); // missing for delete, obviously
            var item, result;

            // put or delete
            if (putOrDelete==='put') {
                var newVersion = java.util.UUID.randomUUID().toString();
                item = googlestore.entity("Item", key,
                                          makeUserDbKey(uuid, dbname), {});
                item.setUnindexedProperty('value', new Text(value));
                item.setUnindexedProperty('version', newVersion);
                googlestore.put(item);
                result = {
                    version: ''+newVersion // Java string -> JavaScript string
                };
            } else { // delete
                googlestore.del(makeUserDbItemKey(uuid, dbname, key));
                result = true;
            }
            ajaxResponse(response).write(result);
        }
    },
    "/putif/([a-zA-Z0-9_-]+)": {
        post: function(request, response, matches) {
            var uuid = matches[1];
            var p = param(request);
            var dbname = p("dbname");
            var key = p("key");
            var value = p("value");
            var oldVersion = p("version");
            var item, result, newVersion;

            // put new value *iff* old value still has the given version.
            // 'none' for old version means 'does not exist'
            var txn = googlestore.datastore.beginTransaction();
            try {
                try {
                    item = googlestore.get(makeUserDbItemKey(uuid,dbname,key));
                    newVersion = item.getProperty('version');
                } catch (e if e.javaException instanceof
                         googlestore.EntityNotFoundException) {
                    item = googlestore.entity("Item", key,
                                              makeUserDbKey(uuid, dbname), {});
                    newVersion = new java.lang.String('none');
                }
                if (!newVersion.equals(oldVersion)) { // Java Strings
                    result = {
                        success: false,
                        reason: 'entity changed'
                    };
                } else {
                    newVersion = java.util.UUID.randomUUID().toString();
                    item.setUnindexedProperty("value", new Text(value));
                    item.setUnindexedProperty("version", newVersion);
                    googlestore.put(item);
                    result = {
                        success: true,
                        version: ''+newVersion // Java string -> JavaScript
                    };
                }
                txn.commit();
            } finally {
                if (txn.isActive()) {
                    txn.rollback();
                    result = {
                        success: false,
                        reason: 'transaction conflict'
                    };
                }
            }
            ajaxResponse(response).write(result);
        }
    },
    "/(keys|list)/([a-zA-Z0-9_-]+)": {
        get: function(request, response, matches) {
            var keysOrList = matches[1];
            var uuid = matches[2];
            var p = param(request);
            var dbname = p("dbname");
            var cursor = p("cursor"); // optional
            var callback = p("callback"); // JSONP (optional)
            console.log('CSA cursor', cursor, 'callback', callback);
            // enumerate items
            var userDbKey = makeUserDbKey(uuid, dbname);
            var query = googlestore.query("Item").setAncestor(userDbKey);
            if (keysOrList==='keys') { query.setKeysOnly(); }
            if (cursor && ''+cursor) { query.startCursor(cursor); }
            var resultIter = query.fetchAsIterable(BATCH_SIZE).iterator();
            var result = [], obj;
            while (resultIter.hasNext()) {
                var item = resultIter.next();
                var key = item.getKey().getName();
                if (keysOrList==='keys') {
                    obj = ''+key; // convert to JavaScript string
                } else {
                    obj = {
                        // convert from Java Strings to JavaScript
                        // (see implementation of get, above)
                        key: ''+key,
                        value: ''+item.getProperty('value').getValue(),
                        version: ''+item.getProperty('version')
                    }
                }
                result.push(obj);
            }
            var endCursor = (result.length === BATCH_SIZE) ?
                resultIter.getCursor().toWebSafeString() :
                null;

            ajaxResponse(response, callback).write({
                cursor: ''+endCursor,
                result: result
            });
        }
    },
    "/nuke/([a-zA-Z0-9_-]+)": {
        post: function(request, response, matches) {
            var uuid = matches[1];
            var p = param(request);
            var dbname = p("dbname");
            var cursor = p("cursor"); // optional
            var userDbKey = makeUserDbKey(uuid, dbname);
            var query = googlestore.query("Item").setAncestor(userDbKey);
            query.setKeysOnly();
            if (cursor && ''+cursor) { query.startCursor(cursor); }
            var resultIter = query.fetchAsIterable(BATCH_SIZE).iterator();
            var count = 0;
            while (resultIter.hasNext()) {
                var entity = resultIter.next();
                googlestore.del(entity.getKey());
                count++;
            }
            var endCursor = (count === BATCH_SIZE) ?
                resultIter.getCursor().toWebSafeString() :
                null;

            ajaxResponse(response).write({
                // indicate if we need to continue this operation
                cursor: ''+endCursor
            });
        }
    },

    "/": {
        get: function(request, response) {
            var p = param(request);

            var html = mustache.to_html(render("skins/index.html"), {
                'package': nell_version['package'],
                version: nell_version.number,
                uuid: 'TESTME'
            });
            print(response).text(html);
            // XXX other info?
        }
    }
};


// simple syntax sugar
function print(response) {
    return {
        text: function(text) {
            if(text) response.getWriter().println(text);
        }
    };
}
function param(request) {
    return function(par) {
        var p = request.getParameter(par);
        if(p) return p;
        else return false;
    }
}
