var apejs = require("apejs.js");
var console = require("console.js");
var googlestore = require("googlestore.js");
var version = require("version.js");

var mustache = require("./common/mustache.js");

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
    var userKey = googlestore.createKey("User", uuid);
    var dbKey = googlestore.createKey(userKey, "Database", dbname);
    return dbKey;
};
var makeUserDbItemKey = function(uuid, dbname, key) {
    var dbKey = makeUserDbKey(uuid, dbname);
    var itemKey = googlestore.createKey(dbKey, "Item", key);
    return itemKey;
};

apejs.urls = {
    "/version": {
        get: function(request, response, matches) {
            var p = param(request);
            var callback = p("callback"); // JSONP (optional)
            ajaxResponse(response, callback).write(version);
        }
    },
    "/(get|exists)/([a-zA-Z0-9_-]+)": {
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
                result = item ? JSON.parse(item.getProperty('value')) : null;
            } else { // exists
                result = found;
            }
            ajaxResponse(response, callback).write(result);
        }
    },
    "/(put|delete)/([a-zA-Z0-9_-]+)": {
        post: function(request, response, matches) {
            var putOrDelete = matches[1];
            var uuid = matches[2];
            var p = param(request);
            var dbname = p("dbname");
            var key = p("key");
            var value = p("value"); // missing for delete, obviously
            var entity;

            // put or delete
            if (putOrDelete==='put') {
                JSON.parse(value); // validate.
                entity = googlestore.entity("Item", key,
                                            makeUserDbKey(uuid, dbname), {
                    value: value
                });
                googlestore.put(entity);
            } else { // delete
                googlestore.del(makeUserDbItemKey(uuid, dbname, key));
            }
            ajaxResponse(response).write(true);
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
            // enumerate items
            var userDbKey = makeUserDbKey(uuid, dbname);
            var query = googlestore.query("Item").setAncestor(userDbKey);
            if (keysOrList==='keys') { query.setKeysOnly(); }
            if (cursor) { query.startCursor(cursor); }
            var resultIter = query.fetchAsIterable(BATCH_SIZE).iterator();
            var result = [], obj;
            while (resultIter.hasNext()) {
                var entity = resultIter.next();
                var key = entity.getKey().getName();
                if (keysOrList==='keys') {
                    obj = key;
                } else {
                    obj = JSON.parse(entity.getProperty('value'));
                    obj.key = key;
                }
                result.push(obj);
            }
            var endCursor = resultIter.getCursor.toWebSafeString();

            ajaxResponse(response, callback).write({
                cursor: endCursor,
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
            if (cursor) { query.startCursor(cursor); }
            var resultIter = query.fetchAsIterable(BATCH_SIZE).iterator();
            while (resultIter.hasNext()) {
                var entity = resultIter.next();
                googlestore.del(entity.getKey());
            }
            var endCursor = resultIter.getCursor.toWebSafeString();

            ajaxResponse(response).write({
                cursor: endCursor,
            });
        }
    },

    "/": {
        get: function(request, response) {
            var p = param(request);

            var html = mustache.to_html(render("skins/index.html"), {
                package: version['package'],
                version: version.number,
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
