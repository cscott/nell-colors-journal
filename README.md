# A tiny Journal for Nell's Colors activity

This is a very simple server side component to sync/save drawings from
[Colors for Nell](http://github.com/cscott/nell-colors).

It is based on
[apejs](http://lmatteis.github.com/apejs/), a tiny Javascript framework for
Google App Engine.

## API

The journal is designed to mimic the [lawnchair](http://brian.io/lawnchair/)
interface.  That's basically a key-value data store, where:
- the key is a <db name, key> pair. get/set/exists methods.
- values are arbitrary JSON objects
- we can enumerate all the keys for a given db name
  (results are paged to comply with appengine datastore restrictions)
- we can delete all the keys for a given db name.
  (may require multiple operations due to appengine datastore restrictions)
