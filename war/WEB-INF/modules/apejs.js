importPackage(java.io);

var apejs = {
    urls: {},
    run: function(request, response) {
        var path = request.getPathInfo();
        var httpMethod = request.getMethod().toLowerCase();

        // before running the http verb method run the before handler
        if (typeof this.before == "function") {
            this.before(request, response);
        }

        for (var i in this.urls) {
            var regex = "^"+i+"/?$";
            var matches = path.match(new RegExp(regex));
            if (matches && matches.length) {
                this.urls[i][httpMethod](request, response, matches);
                return; // we found it, stop searching
            }
        }
        
        // there was no matching url
        return response.sendError(response.SC_NOT_FOUND);
    }
};
exports = apejs;
