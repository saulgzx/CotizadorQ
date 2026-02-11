const { app } = require('./routes');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
