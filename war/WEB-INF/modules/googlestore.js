/**
 * Just a small wrapper around Google App Engine
 * low-level datastore api
 */
importPackage(com.google.appengine.api.datastore);

var memcache = require("memcache.js");

var googlestore = (function(){

    // syntax sugar
    var filterOperators = {
        '<' : 'LESS_THAN',
        '<=': 'LESS_THAN_OR_EQUAL',
        '=' : 'EQUAL',
        '>' : 'GREATER_THAN',
        '>=': 'GREATER_THAN_OR_EQUAL',
        '!=': 'NOT_EQUAL'
    };

    var sortDirections = {
        'ASC' : 'ASCENDING',
        'DESC': 'DESCENDING'
    };
    function isObject( obj ) {
        return toString.call(obj) === "[object Object]";
    } 

    return {
        datastore: DatastoreServiceFactory.getDatastoreService(),
        // shortcut, from com.google.appengine.api.datastore
        EntityNotFoundException: EntityNotFoundException,

        // creates a new entity
        // (kind, [opt] keyName/keyId, [opt] properties)
        entity: function(arg0, arg1, arg2, arg3) {
            var data, entity;
            if (arg3) {
                entity = new Entity(arg0, arg1, arg2);
                data = arg3;
            } else if (arg2) {
                entity = new Entity(arg0, arg1);
                data = arg2;
            } else {
                entity = new Entity(arg0);
                data = arg1;
            }
            this.set(entity, data);
            return entity;
        },
        // google's datastore doesn't like native arrays.
        // it needs a Collection for properties with
        // multiple values
        set: function(entity, data) {
            for (var i in data) {
                if (data[i] instanceof Array)
                    data[i] = java.util.Arrays.asList(data[i]);

                if(isObject(data[i])) {
                    // heck, let's stringify it
                    data[i] = JSON.stringify(data[i]);
                }
                entity.setProperty(i, data[i]);
            }
        },
        // (key)
        // (entity)
        // (kind, [opt] properties)
        // (kind, [opt] keyName/keyId, [opt] properties)
        put: function(arg0, arg1, arg2) {
            var entity = arg1 ? this.entity(arg0, arg1, arg2) : arg0;
            return this.datastore.put(entity);
        },
        // (key)
        // (kind, [opt] keyId/keyName)
        get: function(arg0, arg1) {
            var key = arg1 ? KeyFactory.createKey(arg0, arg1) : arg0;
            return this.datastore.get(key);
        },
        // (key)
        // (kind, [opt] keyId/keyName)
        del: function(arg0, arg1) {
            var key = arg1 ? KeyFactory.createKey(arg0, arg1) : arg0;
            this.datastore["delete"].call(this.datastore, key);
        },
        query: function(kind) {
            var q = new Query(kind);
            var options = FetchOptions.Builder.withDefaults();
            var cacheKey = null;
            var expireSecs = null;
            var self;
            function filter(propertyName, operator, value) {
                operator = filterOperators[operator] || operator;
                q.addFilter(propertyName, Query.FilterOperator[operator], value);
                return self;
            }
            function sort(propertyName, direction) {
                direction = sortDirections[direction||"ASC"] || direction;
                q.addSort(propertyName, Query.SortDirection[direction]);
                return self;
            }
            function setAncestor(key) {
                q.setAncestor(key);
                return self;
            }
            function setKeysOnly() {
                q.setKeysOnly();
                return self;
            }
            function startCursor(cursorString) {
                options = options.startCursor(Cursor.
                                              fromWebSafeString(cursorString));
            }
            function limit(limit) {
                options = options.limit(limit);
                return self;
            }
            function offset(offset) {
                options = options.offset(offset);
                return self;
            }
            function setCacheKey(key, secs) {
                cacheKey = key;
                if(secs) expireSecs = secs;
                return self;
            }
            function fetch(num) {
                if(cacheKey) {
                    var data = memcache.get(cacheKey);
                    if(data) {
                        //log("getting it from cache");
                        return data;
                    }
                }
                //log("getting it from datastore");
                if (num) limit(num);
                var preparedQuery = googlestore.datastore.prepare(q);
                var ret = preparedQuery.asList(options).toArray();
                if(cacheKey) {
                    // expire after expireSecs if it exists
                    if(expireSecs) 
                      memcache.put(cacheKey, ret, expireSecs);
                    else 
                      memcache.put(cacheKey, ret);
                }
                return ret;
            }
            function fetchAsIterable(num) {
                if (num) limit(num);
                var preparedQuery = googlestore.datastore.prepare(q);
                return preparedQuery.asQueryResultIterable(options);
            }
            function count() {
                var preparedQuery = googlestore.datastore.prepare(q);
                return preparedQuery.countEntities(options);
            }
            self = {
                filter : filter,
                sort   : sort,
                setAncestor: setAncestor,
                setKeysOnly: setKeysOnly,
                startCursor: startCursor,
                limit  : limit,
                offset : offset,
                setCacheKey: setCacheKey,
                fetch  : fetch,
                fetchAsIterable : fetchAsIterable,
                count  : count
            };
            return self;
        },
        // abstracting everything as possible
        createKey: function(arg0, arg1, arg2) {
            if (arguments.length === 3) {
                return KeyFactory.createKey(arg0/*parent*/,
                                            arg1/*kind*/, arg2/*id*/);
            } else {
                return KeyFactory.createKey(arg0/*kind*/, arg1/*id*/);
            }
        },

        /**
         * transforms an entity into a nice
         * JavaScript object ready to be stringified
         * so we don't have to call getProperty() all the time.
         * this should be more generic. only supports values
         * that are directly convertable into strings
         * otherwise JSON won't show them
         */
        toJS: function(entity) {
            var properties = entity.getProperties(),
                entries = properties.entrySet().iterator();

            var ret = {};
            while(entries.hasNext()) {
                var entry = entries.next(),
                    key = entry.getKey(),
                    value = entry.getValue();

                if(value instanceof BlobKey) {
                    // get metadata
                    var blobInfo = new BlobInfoFactory().loadBlobInfo(value),
                        contentType = blobInfo.getContentType();
                    // based on the mime type we need to figure out which image to show
                    if(!contentType.startsWith("image")) { // default to plain text
                        value = "<a target='_blank' href='/serve/"+value.getKeyString()+"'>"+blobInfo.getFilename()+"</a>";
                    } else {
                        value = "<a target='_blank' href='/serve/"+value.getKeyString()+"'><img src='/serve/"+value.getKeyString()+"' /></a>";
                    }
                } else if(value instanceof Text) {
                    value = value.getValue();
                }

                // putting an empty string in front of it
                // casts it to a JavaScript string even if it's
                // more of a complicated type
                ret[key] = ""+value;

                // always try to parse this string to see if it's valid JSON
                try {
                  ret[key] = JSON.parse(value);
                } catch(e) {
                  // not valid JSON - don't do anything
                }

            }

            return ret;
        }

    };
})();

exports = googlestore;
